// Weather-forecast page renderer.
// Consumes the station forecast JSON (contract_version 3) and renders it,
// localized via i18next. All values from the JSON go into the DOM through
// textContent/createElement (never innerHTML) — XSS-safe by construction.
//
// Invariant: new forecast i18n keys are consumed ONLY through el()/t() here,
// never via data-i18n (i18n.js updateContent() uses innerHTML for those, which
// must stay authored-static — never a sink for JSON-derived text).

(function () {
  "use strict";

  const CONTRACT = 3;
  const DEFAULT_URL = "/weather/latest.json";
  const REFETCH_MS = 20 * 60 * 1000; // data updates every 30 min; poll a bit finer
  // The hut sits behind a VSAT link (RTT 600–1500 ms, frequent stalls). 8 s used
  // to turn responses that would have arrived at 12 s into hard errors.
  const FETCH_TIMEOUT_MS = 20000; // background polling
  const MANUAL_FETCH_TIMEOUT_MS = 25000; // explicit ↻ tap — the user is waiting
  const STALE_MIN = 40; // client-side "too old" threshold (server flag may be frozen)
  const VISIBLE_REFETCH_MIN = 10; // on tab focus, only refetch if data older than this
  // The satellite channel typically comes back within 30–90 s; without these the
  // next attempt would be a full REFETCH_MS (20 min) away.
  const RETRY_MS = [10000, 30000, 90000];
  const AGE_TICK_MS = 60000; // re-render the "N min ago" line without refetching

  // --- state ---
  let lastData = null; // last successfully parsed payload
  let lastOkAt = 0; // Date.now() of last successful fetch
  let lastError = null; // last fetch/parse error (null when last fetch ok)
  let reqSeq = 0; // monotonic request id — ignore stale responses
  let inFlight = false; // single-flight guard
  let selectedAltitude = "base"; // hourly timeline altitude ("base" | number)
  let detailHour = null; // time_utc of the hour whose detail panel is open, or null
  let started = false;
  let retryIdx = 0; // index into RETRY_MS for the post-failure backoff
  let retryTimer = null; // pending backoff timer, if any
  let refreshBtn = null; // the ↻ button node — kept alive across re-renders
  let updatedTextEl = null; // the text span inside #wf-updated (button lives next to it)
  let detailPushed = false; // we pushed a history entry for the open hour panel

  function prefersReducedMotion() {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // On opening an hour, bring the detail panel into view and focus it. The panel
  // sits UNDER the timeline, and we scroll with block:"nearest" — scrolling the
  // block to the top used to push the table off-screen, which broke the whole
  // point of the panel (comparing the open hour with its neighbours).
  function focusDetail() {
    const d = document.getElementById("wf-hdetail");
    if (!d) return;
    d.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
    });
    d.focus({ preventScroll: true });
  }

  // --- view state in the URL fragment -------------------------------------
  // Altitude and the open hour lived in memory only: a reload (or a link sent to
  // a partner: "look at 04:00 at 4000 m") lost them. Kept in location.hash via
  // replaceState so it stays out of the back stack — except the hour panel,
  // which pushes one entry so Android's system Back closes the panel instead of
  // leaving the page.
  function hashState() {
    const out = {};
    (location.hash || "")
      .replace(/^#/, "")
      .split("&")
      .forEach(function (pair) {
        if (!pair) return;
        const i = pair.indexOf("=");
        if (i < 0) return;
        try {
          out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
        } catch (e) {
          /* malformed fragment — ignore this key */
        }
      });
    return out;
  }

  function buildHashUrl() {
    const parts = [];
    if (selectedAltitude !== "base")
      parts.push("alt=" + encodeURIComponent(selectedAltitude));
    if (detailHour) parts.push("h=" + encodeURIComponent(detailHour));
    return parts.length
      ? "#" + parts.join("&")
      : location.pathname + location.search;
  }

  function writeHash(push) {
    if (typeof history === "undefined" || !history.replaceState) return;
    try {
      const url = buildHashUrl();
      if (push && history.pushState) history.pushState({ wf: 1 }, "", url);
      else history.replaceState({ wf: 1 }, "", url);
    } catch (e) {
      /* file:// and friends — the URL is a nicety, never a requirement */
    }
  }

  // Adopt the fragment into module state. Returns true when something changed,
  // so the popstate/hashchange handlers can skip a pointless re-render (both
  // events can fire for one navigation).
  function applyHash() {
    const s = hashState();
    let changed = false;
    let alt = "base";
    if (s.alt != null && s.alt !== "base") {
      const n = Number(s.alt);
      if (isFinite(n)) alt = n; // renderHourly drops it if the data lacks it
    }
    if (alt !== selectedAltitude) {
      selectedAltitude = alt;
      changed = true;
    }
    const h = s.h || null;
    if (h !== detailHour) {
      detailHour = h;
      changed = true;
    }
    return changed;
  }

  // Opening an hour adds exactly one history entry (re-opening another hour just
  // rewrites it), so Back closes the panel rather than leaving the page.
  function pushDetailHistory() {
    writeHash(!detailPushed);
    detailPushed = true;
  }

  // The hour column button for a given time_utc, if the timeline is rendered.
  function hourColFor(tu) {
    if (!tu) return null;
    return document.querySelector(
      '#wf-hourly .wf-hcol[data-h="' + cssEscape(tu) + '"]'
    );
  }

  // The ONE way to close the hour panel — used by ✕, the bottom button, Esc and
  // a second tap on the open column. Module-scope precisely because the column
  // handler lives outside the panel: when it closed the panel on its own it
  // updated neither the URL nor the history, so Back became a silent no-op, the
  // stale "#h=" stayed in the address bar, and a shared link opened a panel the
  // sender had closed.
  function closeDetail(backTo) {
    detailHour = null;
    if (lastData) {
      renderHourlyInto(lastData);
      const b = hourColFor(backTo);
      if (b) b.focus();
    }
    // Unwind the entry we pushed when the panel opened, so an explicit close
    // doesn't leave a stale "open panel" step in the back stack.
    if (detailPushed) {
      detailPushed = false;
      if (typeof history !== "undefined" && history.back) history.back();
    } else {
      writeHash(false);
    }
  }

  // --- data source (dev hook: ?data=<relative-path> only) ---
  function dataUrl() {
    try {
      const q = new URLSearchParams(location.search).get("data");
      if (q && !/^(?:[a-z]+:)?\/\//i.test(q) && !q.startsWith("\\")) {
        return q; // relative path only — never an absolute/protocol-relative URL
      }
    } catch (e) {
      /* ignore */
    }
    return DEFAULT_URL;
  }

  // --- tiny DOM builders (safe: text is set via textContent) ---
  function el(tag, opts, children) {
    const n = document.createElement(tag);
    if (opts) {
      if (opts.class) n.className = opts.class;
      if (opts.text != null) n.textContent = opts.text;
      if (opts.title) n.title = opts.title;
      if (opts.attrs) {
        for (const k in opts.attrs) n.setAttribute(k, opts.attrs[k]);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function t(key, opts) {
    return i18next.t(key, opts);
  }

  // Localized enum label from a whitelist. The contract explicitly allows new
  // codes, so a miss is expected in the field — return null (+ warn) and let the
  // caller substitute a human phrase. Never leak the raw code: "[wind_shear]" in
  // a risk badge is untranslated English in the most-read place on the page.
  // EVERY caller must handle null (fallback text or skip the node).
  function enumLabel(group, code) {
    if (code == null) return null;
    const key = "wf_" + group + "_" + code;
    const s = i18next.t(key);
    if (s === key) {
      console.warn("[weather] missing i18n key:", key);
      return null;
    }
    return s;
  }

  // --- formatting helpers ---
  function hhmm(local) {
    // RFC3339 local, e.g. "2026-07-27T19:00:00+06:00" -> "19:00"
    return typeof local === "string" && local.length >= 16
      ? local.slice(11, 16)
      : t("wf_no_data");
  }

  function ddmm(local) {
    // "2026-07-28..." -> "28.07"
    const p = typeof local === "string" ? local.slice(0, 10).split("-") : [];
    return p.length === 3 ? p[2] + "." + p[1] : "";
  }

  function num(v, digits) {
    if (v == null || (typeof v === "number" && !isFinite(v))) return null;
    let f = digits == null ? Number(v) : Number(Number(v).toFixed(digits));
    if (f === 0) f = 0; // normalize -0 -> 0
    return String(f);
  }

  // Value + unit, or the localized "no data" dash when null.
  function unit(v, u, digits) {
    const s = num(v, digits);
    return s == null ? t("wf_no_data") : s + (u || "");
  }

  function clientAgeMin(issuedLocal) {
    if (typeof issuedLocal !== "string") return null;
    const ts = Date.parse(issuedLocal);
    if (isNaN(ts)) return null;
    return Math.max(0, Math.floor((Date.now() - ts) / 60000));
  }

  // Forecast age in minutes. The server's age_minutes is a snapshot baked into
  // the static file at generation (≈0) — it does NOT advance as the browser
  // re-polls the same file for up to 30 min, so trusting it alone pins the
  // display at "0 min ago" and would defeat staleness detection if the
  // generator stalls (frozen age_minutes=0, stale=false). Compute the live age
  // from issued_at (client clock) and take the MAX with the server value: the
  // client calc gives real elapsed time, while the server value is a floor so a
  // phone whose clock runs behind can't make old data look fresh. Prefer the
  // absolute issued_at_utc over the local timestamp.
  function ageMin(f) {
    const client = clientAgeMin(f && (f.issued_at_utc || f.issued_at_local));
    const server =
      f && typeof f.age_minutes === "number" && isFinite(f.age_minutes)
        ? Math.max(0, Math.floor(f.age_minutes))
        : null;
    if (client == null) return server;
    if (server == null) return client;
    return Math.max(client, server);
  }

  // No arrow at all when the tendency is unknown: "→?" glued onto the pressure
  // read as "1012 гПа →? (нет данных)" — the localized reason says it better.
  function tendencyArrow(v) {
    if (v == null) return "";
    if (v > 0.1) return "↑";
    if (v < -0.1) return "↓";
    return "→";
  }

  // Wind direction as a localized compass abbreviation, by the meteorological
  // convention: the direction the wind blows FROM (deg 0 = from north = С/N).
  // (The old arrows pointed where the wind was going — the opposite — which
  // users found confusing.)
  const WIND_DIR_CODES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  function windDir(deg) {
    if (deg == null) return "";
    return t("wf_dir_" + WIND_DIR_CODES[Math.round(deg / 45) % 8]);
  }

  // Wind that risk thresholds are compared against (contract 0.15.0): "mean" mode
  // → the mean wind, "p90" mode → the ensemble upper-estimate wind (wind_p90_ms,
  // always ≥ wind_ms). null must render as a dash (unit() → "—"), NOT zero, and
  // must NOT fall back to wind_ms — a different null-rule from temp_p10_c/p90_c.
  function assessedWindMs(f, a) {
    return f && f.threshold_mode === "p90" ? a.wind_p90_ms : a.wind_ms;
  }

  // Guarded lookups for the p90 strings — they only render in the dormant p90
  // mode, so a dropped translation wouldn't surface in prod. On a miss: warn,
  // then fall back to an existing key (labels) or "" (free text) — never leak
  // the raw key to the user.
  function pickKey(preferred, fallback) {
    if (i18next.exists(preferred)) return preferred;
    console.warn("[weather] missing i18n key:", preferred);
    return fallback;
  }
  function tg(key, opts) {
    const s = i18next.t(key, opts);
    if (s === key) {
      console.warn("[weather] missing i18n key:", key);
      return "";
    }
    return s;
  }
  // Same, but with an explicit literal fallback for keys whose absence would
  // leave a value unreadable (a bare wind number with no unit, say).
  function tf(key, fallback, opts) {
    const s = i18next.t(key, opts);
    if (s === key) {
      console.warn("[weather] missing i18n key:", key);
      return fallback;
    }
    return s;
  }
  function msUnit() {
    return tf("wf_unit_ms", "m/s");
  }

  // Horizontal offset of a column inside the scroll container. Measured from the
  // rects rather than offsetLeft: offsetLeft is relative to the nearest
  // POSITIONED ancestor, which the timeline need not be, so it silently stops
  // matching scrollLeft the moment the CSS changes.
  function colOffset(timeline, node) {
    return (
      node.getBoundingClientRect().left -
      timeline.getBoundingClientRect().left +
      timeline.scrollLeft
    );
  }

  // Safe attribute-selector value (time_utc is same-origin data, but may hold
  // characters that break a CSS selector).
  function cssEscape(s) {
    return typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(String(s))
      : String(s).replace(/["\\]/g, "\\$&");
  }

  const SKY_GLYPH = { clear: "☀️", partly: "⛅", cloudy: "☁️", overcast: "☁️" };
  const PRECIP_GLYPH = {
    none: "",
    drizzle: "🌦️",
    rain: "🌧️",
    heavy_rain: "⛈️",
    snow: "🌨️",
  };

  const MOON_GLYPH = {
    new: "🌑",
    waxing_crescent: "🌒",
    first_quarter: "🌓",
    waxing_gibbous: "🌔",
    full: "🌕",
    waning_gibbous: "🌖",
    last_quarter: "🌗",
    waning_crescent: "🌘",
  };

  // WHO UV-index scale → localized level key + highlight class (fill, dark-safe).
  function uvInfo(uv) {
    if (uv == null) return null;
    if (uv >= 11) return { level: "wf_uv_extreme", cls: "wf-uv-very-high" };
    if (uv >= 8) return { level: "wf_uv_very_high", cls: "wf-uv-very-high" };
    if (uv >= 6) return { level: "wf_uv_high", cls: "wf-uv-high" };
    if (uv >= 3) return { level: "wf_uv_moderate", cls: "" };
    return { level: "wf_uv_low", cls: "" };
  }

  function qualityClass(q) {
    if (q === "ok") return "wf-q-ok";
    if (q === "caution") return "wf-q-warn";
    if (q === "bad") return "wf-q-bad";
    if (q === "severe") return "wf-q-severe";
    // unknown AND any unrecognised future code → off-scale grey ("no data"),
    // never green/yellow: "no data" != "safe".
    return "wf-q-unknown";
  }

  // Non-colour verdict marker so the hour verdict isn't conveyed by hue alone
  // (WCAG 1.4.1) — critical for red/green colour-blindness and phone-in-sun.
  // severe keeps ⛔ (NO-GO); every other state gets its own glyph. "ok" needs one
  // too: with a glyph-less "ok" the 3 px green top border was the ONLY cue, and
  // on a phone in direct sun it is indistinguishable from the grey "unknown" —
  // worse, the missing glyph reads as "hasn't rendered yet".
  const VERDICT_GLYPH = { ok: "✓", caution: "⚠", bad: "✕", severe: "⛔", unknown: "?" };

  // The contract allows new quality codes, but the page has exactly five: CSS
  // knows .wf-hq-{ok,caution,bad,severe,unknown} and nothing else. An unmapped
  // code used to print the raw i18n key AND leave the header stripe transparent
  // — i.e. an unrecognised (possibly dangerous) verdict looked SAFER than "no
  // data". Normalize to "unknown" instead.
  const QUALITY_CODES = ["ok", "caution", "bad", "severe", "unknown"];
  function qualityCode(q) {
    return QUALITY_CODES.indexOf(q) === -1 ? "unknown" : q;
  }
  function verdictMark(q) {
    const g = VERDICT_GLYPH[q];
    return g
      ? el("span", { class: "wf-vmark", text: g, attrs: { "aria-hidden": "true" } })
      : null;
  }

  // Localized quality_reason, or null for unknown/missing codes (no raw key).
  function qReasonText(code) {
    if (!code) return null;
    const k = "wf_qreason_" + code;
    const s = t(k);
    return s === k ? null : s;
  }

  // Per-hour altitude verdict state (§2.1). THREE distinct cases — the last two
  // both have critical_altitude_m == null but must NOT look the same:
  //   'bad'    → number: above this altitude the verdict is bad+
  //   'ok'     → null but some alt has a verdict: all altitudes acceptable
  //   'nodata' → null and every alt quality is null: no per-altitude verdict
  //              at all ("no data", must not read as "all good").
  function criticalAltState(h) {
    if (h.critical_altitude_m != null)
      return { kind: "bad", m: h.critical_altitude_m };
    const alt = Array.isArray(h.alt) ? h.alt : [];
    const hasVerdict = alt.some(function (a) {
      return a && a.quality != null;
    });
    return { kind: hasVerdict ? "ok" : "nodata" };
  }

  // freezing_level_m is trustworthy as a fact only when anchored (§2.5). null /
  // raw_blend / missing (and any unknown future code) → treat as estimate.
  function freezingVerified(source) {
    return (
      source === "interpolated" ||
      source === "clamped_below" ||
      source === "clamped_above"
    );
  }

  // Expected visibility across models (median). Falls back to the single-model
  // worst case for pre-0.7.2 data that has no median. null = no data.
  function visMeters(h) {
    return h.visibility_median_m != null
      ? h.visibility_median_m
      : h.visibility_min_m;
  }

  // Visibility as a display node: the expected (median) value in km, with the
  // worst-case model and fog-model agreement tucked into a tooltip. The actual
  // fog *warning* is the whiteout risk badge (≥2-model consensus), NOT this
  // cell — so a scary red highlight only fires when the expected value is low,
  // never on a lone model's outlier.
  function visNode(h) {
    const m = visMeters(h);
    if (m == null) return el("span", { text: t("wf_no_data") });
    const km = num(m / 1000, 1);
    const parts = [];
    if (h.visibility_min_m != null && h.visibility_min_m !== m) {
      parts.push(t("wf_vis_worst", { km: num(h.visibility_min_m / 1000, 1) }));
    }
    if (
      h.visibility_low_models != null &&
      h.visibility_low_models > 0 &&
      h.visibility_models != null
    ) {
      parts.push(
        t("wf_vis_fog_models", {
          low: h.visibility_low_models,
          total: h.visibility_models,
        })
      );
    }
    // Fog-model agreement shown INLINE (§4.6: "visibility from 300 m, 2 of 5
    // models"), not just in the touch-inaccessible tooltip. Compact "N/M".
    const foggy =
      h.visibility_low_models != null &&
      h.visibility_low_models > 0 &&
      h.visibility_models != null;
    const opts = {};
    if (parts.length) opts.title = parts.join(" · ");
    const low = m < 1000;
    if (low) opts.class = "wf-vis-low";
    // Sub-km visibility must not rely on the background fill alone (WCAG 1.4.1):
    // a "⚠" makes it survive greyscale, colour-blindness and a sunlit screen.
    const node = el("span", opts, (low ? "⚠ " : "") + km);
    if (foggy) {
      // Plain span, not <sub>: subscript rendered at ~8 px, unreadable for the
      // long-sighted reader squinting at a phone without glasses.
      node.appendChild(
        el("span", {
          class: "wf-vis-frac",
          text: " " + h.visibility_low_models + "/" + h.visibility_models,
        })
      );
    }
    return node;
  }

  // Ensemble 10–90% spread (°C) at/above which a temperature is "shaky" and gets
  // the muted-italic marker. Wind uses a similar spread cue (wf-uncertain).
  const TEMP_BAND_WIDE_C = 6;

  // Visible marker for "models disagree — treat this number as approximate".
  // .wf-uncertain is italics only, which no screen reader conveys and which is
  // easy to miss on a small screen, so the meaning gets a visible sign AND words.
  const UNCERTAIN_MARK = "≈";
  function uncertainSr() {
    return el("span", { class: "wf-sr", text: " " + tf("wf_uncertain_sr", "") });
  }

  // Temperature cell: the value in whole degrees, with the ensemble corridor
  // (p10…p90) in a tooltip and a non-colour "shaky" marker (.wf-uncertain, same
  // as uncertain wind) when the band is wide. `inCloud === true` adds a neutral
  // cloud glyph (informational, not a warning). null-safe: no corridor -> plain
  // number; inCloud null/false -> no glyph.
  function tempNode(temp, p10, p90, inCloud) {
    const main = unit(temp, "°", 0);
    const lo = num(p10, 1);
    const hi = num(p90, 1);
    const opts = { text: main };
    let wide = false;
    if (lo != null && hi != null) {
      opts.title = t("wf_temp_band", { lo: lo, hi: hi });
      if (Number(hi) - Number(lo) >= TEMP_BAND_WIDE_C) {
        opts.class = "wf-uncertain";
        wide = true;
        // Italics alone are invisible to a screen reader (WCAG 1.3.1) and easy to
        // miss on a phone; the legend already promises this "≈".
        opts.text = UNCERTAIN_MARK + main;
      }
    }
    const span = el("span", opts);
    if (wide) span.appendChild(uncertainSr());
    if (inCloud === true) {
      // The glyph's meaning used to live only in title= — unreachable on touch
      // and hidden from screen readers. Keep the glyph visible and add the words
      // in an sr-only span (the ☁ itself stays decorative for SR).
      span.appendChild(
        el("span", {
          class: "wf-incloud",
          text: " ☁",
          title: t("wf_incloud"),
        })
      );
      span.appendChild(el("span", { class: "wf-sr", text: " " + t("wf_incloud") }));
    }
    return span;
  }

  // --- section helpers ---
  // Card titles are h2: they sit directly under the page h1, and an h1 → h3 jump
  // breaks heading navigation in screen readers.
  function card(titleKey, children) {
    return el("section", { class: "section wf-card" }, [
      el("h2", { class: "section_title", text: t(titleKey) }),
      el("div", { class: "wf-card__body" }, children),
    ]);
  }

  function kv(labelKey, valueNode) {
    return el("div", { class: "wf-kv" }, [
      el("span", { class: "wf-kv__k", text: t(labelKey) }),
      el(
        "span",
        { class: "wf-kv__v" },
        typeof valueNode === "string"
          ? document.createTextNode(valueNode)
          : valueNode
      ),
    ]);
  }

  function banner(kind, text) {
    // Danger banners (storm, stale, contract) are urgent → assertive so screen
    // readers announce them promptly even amid other DOM churn; info/warn stay
    // polite (the #wf-banners region itself is aria-live="polite").
    const attrs = kind === "danger" ? { role: "alert" } : null;
    return el("div", { class: "wf-banner wf-banner--" + kind, attrs: attrs }, text);
  }

  function riskBadge(code) {
    const unknown = /_unknown$/.test(code);
    // Hard-blocker tiers (no _unknown form exists for these — §1.4).
    const severe = code === "wind_severe" || code === "gust_severe";
    let cls = "wf-risk";
    let prefix = "";
    if (unknown) {
      cls += " wf-risk--unknown"; // grey: "not assessed", distinct badge (§4.1)
      prefix = "? ";
    } else if (severe) {
      cls += " wf-risk--severe"; // red + NO-GO glyph, distinct from normal (§4.2)
      prefix = "⛔ ";
    }
    // Unknown future code → a generic localized phrase, never the raw code.
    const label = enumLabel("risk", code) || t("wf_risk_other");
    return el("span", { class: cls, text: prefix + label, title: label });
  }

  // ============================ RENDER ============================

  function set(id, node) {
    const host = document.getElementById(id);
    if (!host) return;
    host.textContent = "";
    if (node) host.appendChild(node);
  }

  // Slot id → its card's real i18n title key (the slot id ≠ the title key, so a
  // naive "wf_"+id would show a raw key on failure).
  const SECTION_TITLE_KEY = {
    "wf-pressure": "wf_pressure_fc",
    "wf-current": "wf_now",
    "wf-alpine": "wf_alpine_title",
    "wf-avalanche": "wf_avalanche_title",
    "wf-window": "wf_window",
    "wf-thunder": "wf_thunder",
    "wf-night": "wf_night",
    "wf-sun": "wf_sun",
    "wf-hourly": "wf_hourly",
    "wf-sources": "wf_sources",
  };

  // Render one section into its slot, isolated so a failure can't blank the page.
  function section(id, fn) {
    try {
      set(id, fn());
    } catch (e) {
      console.error("[weather] section", id, "failed:", e);
      // Distinct "failed to render" text (not the "—" no-data dash) with the
      // section's real localized title.
      set(
        id,
        card(SECTION_TITLE_KEY[id] || "wf_no_data", el("p", { text: t("wf_section_error") }))
      );
    }
  }

  // Manual refresh — auto-poll can be up to REFETCH_MS away and the channel
  // flaps; give the user an explicit "refresh now" (single-flight guarded).
  // The button node is created ONCE and re-attached on every render: rebuilding
  // it would drop keyboard focus on every background poll, and the busy state
  // (below) has to survive the re-render that a successful fetch triggers.
  function ensureRefreshBtn() {
    if (refreshBtn) return refreshBtn;
    refreshBtn = el("button", { text: "↻", attrs: { type: "button" } });
    refreshBtn.addEventListener("click", function () {
      // Busy is advertised via aria-disabled (see setRefreshBusy), which the
      // browser does not enforce — refuse the click ourselves.
      if (refreshBtn.getAttribute("aria-disabled") === "true") return;
      fetchOnce({ manual: true });
    });
    setRefreshBusy(false);
    return refreshBtn;
  }

  // Feedback for the ↻ tap. Without it the button looked broken: nothing moved
  // for up to the whole fetch timeout, repeat taps were swallowed by the
  // single-flight guard, and showLoading() returns early when data is on screen.
  // NOTE: aria-disabled, never the real `disabled` property. Disabling a focused
  // button drops focus to <body> and leaves it there for the whole fetch — 10–25 s
  // on the VSAT link, after which a keyboard user is ~89 tab stops from the
  // button they just pressed. aria-busy makes the state announceable, which a
  // disabled button never is.
  function setRefreshBusy(busy) {
    if (!refreshBtn) return;
    refreshBtn.setAttribute("aria-disabled", busy ? "true" : "false");
    refreshBtn.setAttribute("aria-busy", busy ? "true" : "false");
    refreshBtn.className = "wf-refresh" + (busy ? " wf-refresh--busy" : "");
    const lbl = busy ? t("wf_refreshing") : t("wf_refresh");
    refreshBtn.setAttribute("aria-label", lbl);
    refreshBtn.title = lbl;
  }

  function renderUpdated(f) {
    const host = document.getElementById("wf-updated");
    if (!host) return;
    const btn = ensureRefreshBtn();
    // Rebuild the host only when our structure isn't there yet — updating the
    // text span in place keeps the ↻ button (and its focus) untouched.
    if (!updatedTextEl || updatedTextEl.parentNode !== host) {
      host.textContent = "";
      updatedTextEl = el("span", { class: "wf-updated__text" });
      host.appendChild(updatedTextEl);
      host.appendChild(document.createTextNode(" "));
      host.appendChild(btn);
    }
    const age = ageMin(f);
    const at = hhmm(f && f.issued_at_local);
    let line =
      age == null
        ? t("wf_updated_unknown")
        : t("wf_updated", { time: at, age: age });
    const cls = [];
    if (lastError) {
      line += " · " + t("wf_refresh_failed");
      cls.push("wf-updated--warn");
    }
    if ((age != null && age > STALE_MIN) || (f && f.stale)) {
      cls.push("wf-updated--stale");
    }
    host.className = "wf-updated " + cls.join(" ");
    updatedTextEl.textContent = line;
    setRefreshBusy(inFlight);
  }

  // The staleness warning is the page's "don't trust these numbers" signal, so
  // "(данным ? мин)" reads as a bug in exactly the wrong place — say it in words
  // when the age can't be computed at all.
  function staleText(f) {
    const age = ageMin(f);
    return age == null ? t("wf_stale_unknown") : t("wf_stale", { age: age });
  }

  function isStale(f) {
    const age = ageMin(f);
    return !!(f && (f.stale || (age != null && age > STALE_MIN)));
  }

  // Data age is computed at render time, but a render only happens every
  // REFETCH_MS. A phone that spent 20 min in a pocket showed "3 мин назад" for
  // data that was 23 min old. Re-render just the freshness line once a minute —
  // no network, and the stale banner is re-evaluated against the same threshold.
  function tickAge() {
    if (!lastData) return;
    renderUpdated(lastData);
    const host = document.getElementById("wf-banners");
    if (!host) return;
    const existing = host.querySelector('[data-stale="1"]');
    if (isStale(lastData)) {
      // Leave an existing banner ALONE. Rewriting its text once a minute (with a
      // new minute count every time) made a role="alert" region re-announce
      // itself forever, talking over the rest of the page. The verdict is what
      // matters here; the exact age lives in the freshness line.
      if (!existing) {
        const b = banner("danger", staleText(lastData));
        b.setAttribute("data-stale", "1");
        host.insertBefore(b, host.firstChild);
      }
    } else if (existing) {
      existing.parentNode.removeChild(existing);
    }
  }

  function renderBanners(f) {
    const host = document.getElementById("wf-banners");
    if (!host) return;
    host.textContent = "";
    if (isStale(f)) {
      const b = banner("danger", staleText(f));
      b.setAttribute("data-stale", "1");
      host.appendChild(b);
    }
    // alarm !== "none" means an alarm definitely EXISTS, so an unrecognised
    // future code must never silence the banner — the raw code stays hidden, but
    // a generic "there is a weather alert" line still goes out.
    const alarm =
      f.alarm && f.alarm !== "none"
        ? enumLabel("alarm", f.alarm) || tf("wf_alarm_other", "")
        : null;
    if (alarm)
      host.appendChild(banner(f.alarm === "storm" ? "danger" : "warn", alarm));
    // Said once, here, instead of five identical placeholder cards below.
    if (allSectionsMissing(f)) {
      const all = tf("wf_nodata_all", t("wf_section_nodata"));
      if (all) host.appendChild(banner("warn", all));
    }
    if (f.mode && f.mode !== "hybrid") {
      const kind = f.mode === "unavailable" ? "danger" : "warn";
      const modeLbl = enumLabel("mode", f.mode);
      if (modeLbl) host.appendChild(banner(kind, modeLbl));
    }
    (f.notes || []).forEach(function (nte) {
      if (!nte || !nte.code) return;
      const key = "wf_note_" + nte.code;
      const text = t(key, nte.params || {});
      if (text === key) {
        // Unknown code — never show a raw i18n key to the user.
        console.warn("[weather] missing note translation:", key);
        return;
      }
      const kind = nte.severity === "warn" ? "warn" : "info";
      host.appendChild(banner(kind, text));
    });
  }

  // No key section at all. Each of these cards then renders the same "no data
  // for this section — that does not mean there is no danger" paragraph, five
  // times in a row: a strong warning repeated five times stops being read.
  function allSectionsMissing(f) {
    return !f.current && !f.window && !f.thunder && !f.night && !f.sun;
  }

  function renderCurrent(f) {
    const c = f.current;
    // A missing section must SAY it's missing. Silently dropping the card lets
    // "no data" read as "nothing to report", which in the mountains is the
    // dangerous reading.
    if (!c)
      return card("wf_now", el("p", { class: "wf-note", text: t("wf_section_nodata") }));
    // Pressure: value, then the tendency arrow only if known, then the localized
    // reason when it isn't. Assembled from parts so an absent arrow leaves no
    // stray spaces ("1012 гПа  (нет данных)").
    const pParts = [unit(c.pressure_hpa, " " + t("wf_unit_hpa"), 1)];
    const arrow = tendencyArrow(c.tendency_hpa_per_3h);
    if (arrow) pParts.push(arrow);
    if (c.tendency_hpa_per_3h == null && c.tendency_unknown_reason) {
      const why = enumLabel("tendreason", c.tendency_unknown_reason);
      pParts.push("(" + (why || t("wf_no_data")) + ")");
    }
    const rows = [
      kv("wf_temp", unit(c.temperature_c, "°C", 0)),
      kv("wf_pressure", pParts.join(" ")),
      kv("wf_humidity", unit(c.humidity_pct, "%")),
      kv(
        "wf_cloud",
        unit(c.cloud_cover_pct, "%") +
          (c.fog ? " · " + t("wf_fog") : "")
      ),
    ];
    // "Now" visibility + snow from the current hour (navigation / conditions).
    const h0 = (Array.isArray(f.hourly) && f.hourly[0]) || {};
    // Wind is the single biggest input to "go / don't go", yet the first screen
    // had none of it — it started only in the hourly table, two screens down.
    // Same gust notation (⇡) as the timeline row.
    if (h0.wind_base_ms != null) {
      rows.push(
        kv(
          "wf_wind_now",
          unit(h0.wind_base_ms, " " + msUnit(), 0) +
            (h0.wind_gusts_ms != null ? " ⇡" + num(h0.wind_gusts_ms, 0) : "")
        )
      );
    }
    if (h0.precip_code && h0.precip_code !== "none") {
      const p = enumLabel("precip", h0.precip_code);
      if (p) rows.push(kv("wf_precip_now", p));
    }
    if (visMeters(h0) != null) {
      rows.push(kv("wf_row_visibility", visNode(h0)));
    }
    // Show a measured 0 too: hiding it made "no snow" and "not measured"
    // identical on screen, and they lead to opposite decisions.
    if (h0.snow_depth_cm != null) {
      rows.push(kv("wf_snow_depth", num(h0.snow_depth_cm, 0)));
    }
    if (c.obs_coverage_pct != null && c.obs_coverage_pct < 80) {
      rows.push(
        el("p", {
          class: "wf-note",
          text: t("wf_low_coverage", { pct: c.obs_coverage_pct }),
        })
      );
    }
    return card(
      "wf_now",
      [
        el("p", {
          class: "wf-sub",
          text: t("wf_at_station", { alt: f.base_altitude_m }),
        }),
      ].concat(rows)
    );
  }

  function renderAlpine(f) {
    const a = f.alpine_availability;
    if (!a) return null;
    if (a.status === "full") return null; // nothing to warn about
    const missing = [];
    [
      "cape",
      "levels_700",
      "levels_600",
      "levels_500",
      "precip_prob",
      "gusts",
      "visibility",
      "lifted_index",
      "convective_inhibition",
      "uv_index",
    ].forEach(function (k) {
      if (a[k] === false) missing.push(t("wf_alpine_" + k));
    });
    const head = [
      enumLabel("alpinestatus", a.status),
      enumLabel("alpinereason", a.reason),
    ].filter(Boolean);
    return el("section", { class: "section wf-card wf-warnbox" }, [
      el("h2", { class: "section_title", text: t("wf_alpine_title") }),
      el("p", { text: head.length ? head.join(" — ") : t("wf_no_data") }),
      el("p", { class: "wf-note", text: t("wf_alpine_warn") }),
      missing.length
        ? el("p", {
            class: "wf-note",
            text: t("wf_alpine_missing") + " " + missing.join(", "),
          })
        : null,
    ]);
  }

  // Avalanche block (§2.3/§4.4): a list of triggered signals, NEVER a danger
  // scale. status is always "unknown" (no snowpack observations exist for the
  // Tien Shan) — we say so explicitly and show flags, incl. "-1" = no data.
  const AVALANCHE_FLAGS = [
    "new_snow_24h",
    "new_snow_48h",
    "wind_transport",
    "rain_on_snow",
    "no_overnight_refreeze",
    "rapid_warming",
    "high_freezing_level",
  ];
  function renderAvalanche(f) {
    const av = f.avalanche;
    // A missing avalanche block must SAY it is missing: silently dropping the
    // section makes "not assessed" indistinguishable from "nothing to report".
    if (!av)
      return el("section", { class: "section wf-card wf-warnbox" }, [
        el("h2", { class: "section_title", text: t("wf_avalanche_title") }),
        el("p", { class: "wf-strong", text: t("wf_avalanche_no_rating") }),
        el("p", { class: "wf-note", text: t("wf_section_nodata") }),
      ]);
    const flags = av.flags || {};
    const list = el("ul", { class: "wf-avlist" });
    // Three states, never two: a flag with no data must NOT be counted as
    // "signal absent". "Triggered: 0 of 7" on seven unassessed flags is the most
    // dangerous sentence the page can print, and it is the one visible by default.
    let triggered = 0;
    let known = 0;
    let nodata = 0;
    AVALANCHE_FLAGS.forEach(function (k) {
      const v = flags[k];
      if (v === 1) {
        triggered++;
        known++;
      } else if (v === 0) {
        known++;
      } else {
        nodata++;
      }
      // 1 → present; 0 → absent; -1 / null / undefined / anything else → no data.
      const state = v === 1 ? "yes" : v === 0 ? "no" : "nodata";
      list.appendChild(
        el("li", { class: "wf-avflag wf-avflag--" + state }, [
          el("span", { class: "wf-avflag__k", text: t("wf_avalanche_flag_" + k) }),
          el("span", { class: "wf-avflag__v", text: t("wf_avalanche_" + state) }),
        ])
      );
    });
    // Collapsed by default. This block renders unconditionally and its seven-row
    // list always opens with "no avalanche rating is derivable" — on a phone that
    // was a whole screen of constant text between the user and the go/no-go
    // answer. The summary carries the one number that varies.
    let summaryText;
    if (known === 0) {
      summaryText = tf(
        "wf_avalanche_summary_nodata",
        t("wf_avalanche_title") + " — " + t("wf_no_data")
      );
    } else if (nodata > 0) {
      summaryText = tf(
        "wf_avalanche_summary_partial",
        t("wf_avalanche_title") +
          " (" +
          triggered +
          "/" +
          known +
          ", " +
          nodata +
          "?)",
        { n: triggered, m: known, k: nodata }
      );
    } else {
      summaryText = tf(
        "wf_avalanche_summary",
        t("wf_avalanche_title") + " (" + triggered + "/" + known + ")",
        { n: triggered, m: known }
      );
    }
    // The summary IS the card's heading — a separate <h2> above it repeated the
    // same word twice in a row.
    const summary = el(
      "summary",
      { class: "wf-details__summary" },
      el("h2", { class: "section_title", text: summaryText })
    );
    // Collapsing is only justified for "everything assessed and clean": if any
    // signal fired, or nothing could be assessed at all, the detail must be
    // visible without a tap.
    const detailsAttrs = triggered > 0 || known === 0 ? { open: "" } : null;
    return el("section", { class: "section wf-card wf-warnbox" }, [
      el("details", { class: "wf-details", attrs: detailsAttrs }, [
        summary,
        // The one thing that must always be said: no rating is derivable.
        el("p", { class: "wf-strong", text: t("wf_avalanche_no_rating") }),
        el("p", { class: "wf-sub", text: t("wf_avalanche_flags_intro") }),
        list,
      ]),
    ]);
  }

  // Humanize a span in hours: "12 ч" / "2 сут" / "2 сут 1 ч". "49 ч" alone reads
  // as an error to most users; days+hours matches how people think about it.
  function humanDuration(hours) {
    if (hours == null) return null;
    if (hours < 24) return t("wf_dur_h", { h: hours });
    const d = Math.floor(hours / 24);
    const h = hours % 24;
    return h ? t("wf_dur_dh", { d: d, h: h }) : t("wf_dur_d", { d: d });
  }

  // The window's from/to are full timestamps but hhmm() drops the date, so a
  // multi-day window looked like a 1-hour one ("12:00–13:00 (49 ч)"). Show the
  // date whenever the window crosses midnight.
  function windowSpan(best) {
    const fromD = typeof best.from_local === "string" ? best.from_local.slice(0, 10) : "";
    const toD = typeof best.to_local === "string" ? best.to_local.slice(0, 10) : "";
    if (fromD && fromD === toD) {
      return t("wf_window_span_sameday", {
        date: ddmm(best.from_local),
        from: hhmm(best.from_local),
        to: hhmm(best.to_local),
      });
    }
    return t("wf_window_span_multiday", {
      fromDate: ddmm(best.from_local),
      from: hhmm(best.from_local),
      toDate: ddmm(best.to_local),
      to: hhmm(best.to_local),
    });
  }

  function renderWindow(f) {
    const w = f.window;
    if (!w)
      return card("wf_window", el("p", { class: "wf-note", text: t("wf_section_nodata") }));
    // "Window" is climber jargon — lead with a plain-language explanation so
    // casual users understand what the card is for, whatever the status.
    const body = [el("p", { class: "wf-sub", text: t("wf_window_intro") })];
    if (w.status === "found" && w.best) {
      body.push(el("p", { class: "wf-strong", text: windowSpan(w.best) }));
      if (w.best.hours != null)
        body.push(
          el("p", {
            class: "wf-note",
            text: t("wf_window_duration", { dur: humanDuration(w.best.hours) }),
          })
        );
      if (w.best.quality) {
        const chip = el("span", {
          class: "wf-chip " + qualityClass(w.best.quality),
          text:
            (w.best.quality === "severe" ? "⛔ " : "") +
            t("wf_window_quality", {
              q: enumLabel("quality", w.best.quality) || t("wf_no_data"),
            }),
        });
        body.push(chip);
      }
      // Latest start that still fits the whole route — NOT "leave now" (§2.6).
      if (w.latest_start_local)
        body.push(
          el("p", {
            class: "wf-note",
            text: t("wf_window_latest_start", { time: hhmm(w.latest_start_local) }),
          })
        );
      if (w.turnaround_at_local)
        body.push(
          el("p", {
            class: "wf-note",
            text: t("wf_window_turnaround", { time: hhmm(w.turnaround_at_local) }),
          })
        );
      if (w.closes_at_local)
        body.push(
          el("p", {
            class: "wf-note",
            text: t("wf_window_closes", { time: hhmm(w.closes_at_local) }),
          })
        );
    } else {
      // "No window in 48 h" and "not enough data" call for opposite strategies,
      // so they must not look alike: the first is a firm answer (strong), the
      // second is an absence of one, with a pointer to the hourly table.
      const statusTxt =
        enumLabel("windowstatus", w.status) || t("wf_window_status_unknown");
      if (w.status === "none_in_48h") {
        body.push(el("p", { class: "wf-strong", text: statusTxt }));
      } else {
        body.push(el("p", { text: statusTxt }));
        // Point at the fallback the user actually has (the hourly table). Skip
        // when statusTxt already is that sentence (unknown-code fallback).
        const hint = t("wf_window_status_unknown");
        if (statusTxt !== hint) body.push(el("p", { class: "wf-note", text: hint }));
      }
    }
    // route_hours is the query parameter ("we searched for an N-hour outing"),
    // present regardless of status; null only means duration isn't configured.
    if (w.route_hours != null)
      body.push(
        el("p", {
          class: "wf-note",
          text: t("wf_window_route_hours", { hours: w.route_hours }),
        })
      );
    return card("wf_window", body);
  }

  function renderThunder(f) {
    const th = f.thunder;
    if (!th)
      return card("wf_thunder", el("p", { class: "wf-note", text: t("wf_section_nodata") }));
    const body = [];
    if (th.first_likely_local)
      body.push(
        el("p", {
          class: "wf-strong",
          text: t("wf_thunder_likely", { time: hhmm(th.first_likely_local) }),
        })
      );
    else if (th.first_possible_local)
      body.push(
        el("p", {
          text: t("wf_thunder_possible", {
            time: hhmm(th.first_possible_local),
          }),
        })
      );
    else body.push(el("p", { text: t("wf_thunder_none") }));
    if (th.confidence && th.confidence !== "normal") {
      const conf = enumLabel("confidence", th.confidence);
      if (conf) body.push(el("p", { class: "wf-note", text: conf }));
    }
    return card("wf_thunder", body);
  }

  function renderNight(f) {
    const n = f.night;
    if (!n)
      return card("wf_night", el("p", { class: "wf-note", text: t("wf_section_nodata") }));
    const body = [
      el("p", {
        class: "wf-strong",
        text:
          (enumLabel("refreeze", n.refreeze) || t("wf_no_data")) +
          " · " +
          t("wf_rockfall") +
          ": " +
          (enumLabel("rockfall", n.rockfall_risk) || t("wf_no_data")),
      }),
      kv("wf_night_min", unit(n.min_temp_base_c, "°C", 0)),
      kv("wf_freezing_level", unit(n.freezing_level_min_m, " " + t("wf_unit_m"))),
    ];
    // Moon — light for a pre-dawn start. Isolated so a moon defect can't wipe
    // the safety data (refreeze / rockfall / min temps) of this card.
    try {
      const m = n.moon;
      if (m) {
        const glyph = MOON_GLYPH[m.phase_code] || "";
        const phaseTxt = m.phase_code ? enumLabel("moonphase", m.phase_code) : null;
        const parts = [];
        if (phaseTxt) parts.push(phaseTxt);
        if (m.illumination_pct != null) parts.push(num(m.illumination_pct, 0) + "%");
        const moonRow = el("div", { class: "wf-kv" }, [
          el("span", { class: "wf-kv__k", text: t("wf_moon") }),
          el("span", { class: "wf-kv__v" }, [
            glyph
              ? el("span", { text: glyph + " ", attrs: { "aria-hidden": "true" } })
              : null,
            document.createTextNode(parts.join(" · ") || t("wf_no_data")),
          ]),
        ]);
        const rise = m.moonrise_local;
        const set = m.moonset_local;
        let avail = null;
        if (rise && set)
          avail = t("wf_moon_riseset", { rise: hhmm(rise), set: hhmm(set) });
        else if (set) avail = t("wf_moon_sets", { time: hhmm(set) });
        else if (rise) avail = t("wf_moon_rises", { time: hhmm(rise) });
        else if (m.up_at_night_start === true) avail = t("wf_moon_allnight");
        else if (m.up_at_night_start === false) avail = t("wf_moon_none");
        const moonNodes = [moonRow];
        if (avail) moonNodes.push(el("p", { class: "wf-note", text: avail }));
        body.splice(1, 0, ...moonNodes); // just under the refreeze/rockfall line
      }
    } catch (e) {
      console.error("[weather] moon render failed", e);
    }
    if (Array.isArray(n.min_temp_alt) && n.min_temp_alt.length) {
      // Show a range "colder … milder" instead of the jargon "p90" column:
      // min_temp_c is the expected low, p90_c the milder (warmer) case.
      const rows = n.min_temp_alt.map(function (a) {
        // Whole degrees, like every other temperature on the page.
        const lo = num(a.min_temp_c, 0);
        const hi = num(a.p90_c, 0);
        const range =
          lo == null
            ? t("wf_no_data")
            : hi == null
            ? lo + "°"
            : lo + "…" + hi + "°";
        return el("tr", null, [
          el("td", { text: unit(a.altitude_m, " " + t("wf_unit_m")) }),
          el("td", { text: range }),
        ]);
      });
      body.push(
        el("table", { class: "wf-table" }, [
          el(
            "thead",
            null,
            el("tr", null, [
              el("th", { text: t("wf_altitude") }),
              el("th", { text: t("wf_night_min_col") }),
            ])
          ),
          el("tbody", null, rows),
        ])
      );
      body.push(el("p", { class: "wf-note", text: t("wf_night_range_note") }));
    }
    return card("wf_night", body);
  }

  function renderSun(f) {
    const s = f.sun;
    // Not the generic wf_section_nodata: "this doesn't mean there is no danger"
    // makes no sense about sunrise/sunset (pure astronomy) and cheapens the same
    // sentence where it does matter — the outing window and the night card.
    if (!s)
      return card(
        "wf_sun",
        el("p", { class: "wf-note", text: tf("wf_sun_nodata", t("wf_no_data")) })
      );
    const kids = [
      kv("wf_sunrise", hhmm(s.sunrise_local)),
      kv("wf_sunset", hhmm(s.sunset_local)),
      kv(
        "wf_civil",
        hhmm(s.civil_dawn_local) + " – " + hhmm(s.civil_dusk_local)
      ),
      kv("wf_daylight", unit(s.daylight_hours, " " + t("wf_hours"), 1)),
    ];
    // Peak UV over the day (glacier sun hazard). Hidden entirely if no data
    // (null peak is NOT "moderate/safe").
    let peak = null;
    let peakTime = null;
    (f.hourly || []).forEach(function (h) {
      if (h.uv_index != null && (peak == null || h.uv_index > peak)) {
        peak = h.uv_index;
        peakTime = h.time_local;
      }
    });
    if (peak != null) {
      const info = uvInfo(peak);
      kids.push(
        el(
          "p",
          { class: "wf-strong" },
          el("span", {
            class: info.cls,
            text: t("wf_uv_peak", {
              uv: num(peak, 0),
              level: t(info.level),
              time: hhmm(peakTime),
            }),
          })
        )
      );
    }
    kids.push(el("p", { class: "wf-note", text: t("wf_ridge_note") }));
    return card("wf_sun", kids);
  }

  // Altitudes present in the data, mapped by altitude_m (never by index).
  function altitudesOf(hourly) {
    const first = hourly && hourly[0] && Array.isArray(hourly[0].alt) ? hourly[0].alt : [];
    return first
      .map(function (a) {
        return a.altitude_m;
      })
      .filter(function (m) {
        return m != null;
      });
  }

  function altOf(hour, altitude_m) {
    return (hour.alt || []).find(function (a) {
      return a.altitude_m === altitude_m;
    });
  }

  function renderHourly(f) {
    const hourly = Array.isArray(f.hourly) ? f.hourly : [];
    if (!hourly.length) {
      // In the offline (zambretti) mode the banner above already says there will
      // be no hourly data at all; "try ↻ again in a few minutes" right under it
      // is a direct contradiction.
      return card(
        "wf_hourly",
        el("p", {
          text:
            f.mode === "zambretti"
              ? tf("wf_hourly_none_offline", t("wf_hourly_empty"))
              : t("wf_hourly_empty"),
        })
      );
    }
    const alts = altitudesOf(hourly);
    if (selectedAltitude !== "base" && alts.indexOf(selectedAltitude) === -1) {
      selectedAltitude = "base";
    }
    const isAlt = selectedAltitude !== "base";
    const rows = hourly; // show the full forecast horizon (current hour + 72)

    // altitude selector (theme-aware segmented control)
    const seg = el("div", { class: "wf-altsel" });
    // srLabel: the visible caption stays a bare number (the control has to fit
    // four options on a phone), but "3500" alone is meaningless when read out —
    // give the accessible name the unit.
    function segBtn(val, label, srLabel) {
      const attrs = { type: "button" };
      if (srLabel) attrs["aria-label"] = srLabel;
      const b = el("button", {
        class: "wf-alt-btn" + (selectedAltitude === val ? " active" : ""),
        text: label,
        attrs: attrs,
      });
      b.addEventListener("click", function () {
        selectedAltitude = val;
        writeHash(false); // survives a reload; not a back-stack entry
        if (lastData) renderHourlyInto(lastData); // cheap: only the timeline
      });
      return b;
    }
    seg.appendChild(segBtn("base", t("wf_alt_base")));
    alts.forEach(function (m) {
      seg.appendChild(segBtn(m, m + "", m + " " + t("wf_unit_m")));
    });

    // A table with a sticky label column so every number is self-explanatory.
    const table = el("table", { class: "wf-htable" });
    table.appendChild(el("caption", { class: "wf-sr", text: t("wf_hourly_caption") }));

    // Mark day boundaries so 73 hours across ~3 days stay readable.
    const newDayCols = new Set();
    // Jump targets for the navigation row above the timeline: "now" plus
    // one button per day boundary.
    const jumpTargets = [];
    const htr = el("tr", null, el("th", { class: "wf-htable__corner" }));
    let prevDay = null;
    rows.forEach(function (h, i) {
      const day =
        typeof h.time_local === "string" ? h.time_local.slice(0, 10) : null;
      const showDate = day && day !== prevDay;
      if (showDate && i > 0) newDayCols.add(i);
      prevDay = day;
      // Colour the header by the verdict of the SELECTED altitude (per-alt
      // quality), or the whole-column worst (h.quality) in base view. Missing
      // verdict → "unknown" (grey), never green — "no data" != "safe".
      const hq = qualityCode(
        isAlt ? (altOf(h, selectedAltitude) || {}).quality : h.quality
      );
      const reason = qReasonText(h.quality_reason);
      // Screen-reader verdict: the colour + glyph mean nothing to SR/keyboard.
      // Just the verdict WORD here — the reason (and the sky emoji, hidden
      // below) used to be read out for all 73 columns, ~9 000 words per swipe.
      // The reason stays reachable via the <th> tooltip and the detail panel.
      const srVerdict = t("wf_quality_" + hq);
      const open = detailHour === h.time_utc;
      const isNow = i === 0;
      const skyTxt = [
        enumLabel("sky", h.sky_code),
        h.precip_code && h.precip_code !== "none"
          ? enumLabel("precip", h.precip_code)
          : null,
      ].filter(Boolean).join(" · ");
      // The header is a real button: tap/keyboard opens the hour-detail panel
      // (all the per-cell detail that used to live only in hover tooltips).
      const hattrs = {
        type: "button",
        "aria-expanded": open ? "true" : "false",
        "data-h": h.time_utc || "",
      };
      // aria-controls only on the open column: when the panel is closed there is
      // no #wf-hdetail in the DOM and 73 dangling references are an a11y error.
      if (open) hattrs["aria-controls"] = "wf-hdetail";
      const hbtn = el(
        "button",
        { class: "wf-hcol" + (open ? " wf-hcol--open" : ""), attrs: hattrs },
        [
          el("span", { class: "wf-sr", text: srVerdict }),
          verdictMark(hq),
          // "Now" anchor: after a horizontal swipe through 73 columns the
          // starting point was otherwise unrecoverable.
          isNow ? el("span", { class: "wf-hnow-badge", text: t("wf_now_marker") }) : null,
          el("div", { class: "wf-hdate", text: showDate ? ddmm(day) : "" }),
          el("div", { class: "wf-hh", text: hhmm(h.time_local) }),
          el("div", {
            class: "wf-hsky",
            text:
              (SKY_GLYPH[h.sky_code] || "") + (PRECIP_GLYPH[h.precip_code] || ""),
            title: skyTxt,
            // Decorative: the words are in the detail panel (§1249).
            attrs: { "aria-hidden": "true" },
          }),
        ]
      );
      hbtn.addEventListener("click", function () {
        // Tapping the open column closes the panel — route that through the same
        // close path as ✕ / Esc / the bottom button so history and the URL stay
        // in sync no matter how the panel was dismissed.
        if (detailHour === h.time_utc) {
          closeDetail(h.time_utc);
          return;
        }
        detailHour = h.time_utc;
        if (lastData) {
          renderHourlyInto(lastData);
          pushDetailHistory();
          focusDetail();
        }
      });
      const th = el(
        "th",
        {
          class:
            "wf-hq-" +
            hq +
            (newDayCols.has(i) ? " wf-newday" : "") +
            (isNow ? " wf-hnow" : ""),
          title: reason || undefined,
          attrs: { scope: "col" },
        },
        hbtn
      );
      if (isNow) jumpTargets.push({ th: th, label: t("wf_now_marker") });
      else if (showDate) jumpTargets.push({ th: th, label: ddmm(day) });
      htr.appendChild(th);
    });
    table.appendChild(el("thead", null, htr));

    const tbody = el("tbody");
    function addRow(labelKey, cellFn) {
      const tr = el("tr", null, el("th", { text: t(labelKey), attrs: { scope: "row" } }));
      rows.forEach(function (h, i) {
        const node = cellFn(h);
        tr.appendChild(
          el(
            "td",
            newDayCols.has(i) ? { class: "wf-newday" } : null,
            node == null ? document.createTextNode("") : node
          )
        );
      });
      tbody.appendChild(tr);
    }
    const txt = function (s) {
      return document.createTextNode(s);
    };

    addRow("wf_row_temp", function (h) {
      if (isAlt) {
        const a = altOf(h, selectedAltitude) || {};
        return tempNode(a.temp_c, a.temp_p10_c, a.temp_p90_c, a.in_cloud);
      }
      return tempNode(h.temp_base_c, h.temp_base_p10_c, h.temp_base_p90_c, null);
    });
    addRow("wf_row_prob", function (h) {
      return txt(h.precip_prob_pct != null ? String(h.precip_prob_pct) : t("wf_no_data"));
    });
    // In "p90" mode the altitude wind value is the upper estimate, not the mean,
    // so the row LABEL carries the marker ("Ветер (верхняя оценка)…") — one
    // always-visible, screen-reader-announced cue per row instead of 73 glyphs.
    const windAltLabel =
      f.threshold_mode === "p90"
        ? pickKey("wf_row_wind_alt_p90", "wf_row_wind_alt")
        : "wf_row_wind_alt";
    addRow(isAlt ? windAltLabel : "wf_row_wind", function (h) {
      if (isAlt) {
        const a = altOf(h, selectedAltitude) || {};
        const uncertain = a.wind_ms_spread == null || a.wind_ms_spread > 3;
        const v = assessedWindMs(f, a); // mean, or p90 upper estimate; null → "—"
        const s =
          unit(v, "", 0) +
          // No direction on a null value ("— NW" would read as calm-with-bearing).
          (v != null && a.wind_dir_deg != null ? " " + windDir(a.wind_dir_deg) : "");
        if (!uncertain) return txt(s);
        const cell = el("span", {
          class: "wf-uncertain",
          text: UNCERTAIN_MARK + s,
        });
        cell.appendChild(uncertainSr());
        return cell;
      }
      // Base station: no direction in the data, but it has gusts. The gust upper
      // estimate is wind_gusts_p90_basis_ms (≥ gusts); the raw wind_gusts_p90_ms
      // is NOT an upper bound (can be below the mean) and is not shown. BASE-only.
      const s =
        unit(h.wind_base_ms, "", 0) +
        (h.wind_gusts_ms != null ? " ⇡" + num(h.wind_gusts_ms, 0) : "");
      const p90 = [];
      if (h.wind_gusts_p90_basis_ms != null)
        p90.push(t("wf_gust_p90", { v: num(h.wind_gusts_p90_basis_ms, 0) }));
      return p90.length
        ? el("span", { text: s, title: t("wf_spread_prefix") + ": " + p90.join(" · ") })
        : txt(s);
    });
    // "Feels like": altitudes carry wind_chill_c, base carries wind_chill_base_c.
    // null = formula inapplicable (warm/calm), not "no data" — so show the row
    // only when at least one hour has a value (summer days are mostly null).
    const feels = function (h) {
      return isAlt
        ? (altOf(h, selectedAltitude) || {}).wind_chill_c
        : h.wind_chill_base_c;
    };
    const feelsShown = rows.some(function (h) {
      return feels(h) != null;
    });
    if (feelsShown) {
      addRow("wf_row_chill", function (h) {
        return txt(unit(feels(h), "°", 0));
      });
    }
    // Relative humidity at altitude (free-air mode; null until the backend
    // switches anchors on). Alt-only, shown only when some hour has a value.
    const rhAt = function (h) {
      return isAlt ? (altOf(h, selectedAltitude) || {}).rh_pct : null;
    };
    const rhShown = isAlt && rows.some(function (h) {
      return rhAt(h) != null;
    });
    if (rhShown) {
      addRow("wf_row_rh", function (h) {
        const v = rhAt(h);
        return txt(v != null ? String(v) : t("wf_no_data"));
      });
    }
    // Visibility (km) = expected (median) value; worst-case model + fog-model
    // agreement live in the cell tooltip. null -> "—". Fog *warnings* come from
    // the whiteout risk badge, not this number.
    const visShown = rows.some(function (h) {
      return visMeters(h) != null;
    });
    if (visShown) {
      addRow("wf_row_visibility", function (h) {
        return visNode(h);
      });
    }
    // Freezing level. Trustworthy as a fact only when anchored (§2.5); raw_blend
    // / missing / null → shown muted with a source tooltip and a legend caveat.
    let flUnverified = false;
    addRow("wf_row_freezing", function (h) {
      if (h.freezing_level_m == null) return txt(t("wf_no_data"));
      const v = num(h.freezing_level_m, 0);
      if (freezingVerified(h.freezing_level_source)) return txt(v);
      flUnverified = true;
      const src = h.freezing_level_source;
      const key = "wf_flsource_" + src;
      const title = src && t(key) !== key ? t(key) : t("wf_flsource_raw_blend");
      const est = el("span", {
        class: "wf-est",
        text: UNCERTAIN_MARK + v,
        title: title,
      });
      est.appendChild(uncertainSr());
      return est;
    });
    // Critical altitude (§2.1): lowest altitude with a bad+ verdict. Show the
    // row whenever an altitude layer exists and any hour isn't plain "ok" — so
    // the 'nodata' case ("no per-altitude verdict") is visible too, not hidden
    // behind "everything's fine". Three per-hour states kept distinct.
    const critStates = rows.map(criticalAltState);
    const critShown =
      alts.length > 0 &&
      critStates.some(function (s) {
        return s.kind !== "ok";
      });
    if (critShown) {
      addRow("wf_row_critical_alt", function (h) {
        const s = criticalAltState(h);
        if (s.kind === "bad")
          // "⚠" so the danger fill isn't the only cue (WCAG 1.4.1).
          return el("span", { class: "wf-vis-low", text: "⚠ " + num(s.m, 0) });
        if (s.kind === "nodata")
          return el("span", {
            text: t("wf_no_data"),
            title: t("wf_critical_alt_nodata"),
          });
        return txt("·"); // 'ok': every altitude acceptable this hour
      });
    }
    // UV index. Shown only when some hour has a value (null = night, not "no data").
    // ≥8 also carries a non-colour marker ("!") and a title, not colour alone.
    const uvShown = rows.some(function (h) {
      return h.uv_index != null;
    });
    if (uvShown) {
      addRow("wf_row_uv", function (h) {
        const v = h.uv_index;
        if (v == null) return txt(t("wf_no_data"));
        const info = uvInfo(v);
        const label = t(info.level);
        return info.cls
          ? el("span", {
              class: info.cls,
              text: num(v, 0) + (v >= 8 ? "!" : ""),
              title: label,
            })
          : el("span", { text: num(v, 0), title: label });
      });
    }
    addRow("wf_row_risks", function (h) {
      // Common-hour risks; at an altitude, add that altitude's own risks
      // (7-code subset). Empty = no verdict, NOT "no risks" — just render nothing.
      const codes = Array.isArray(h.risks) ? h.risks.slice() : [];
      if (isAlt) {
        const ar = (altOf(h, selectedAltitude) || {}).risks;
        if (Array.isArray(ar))
          ar.forEach(function (c) {
            if (codes.indexOf(c) === -1) codes.push(c);
          });
      }
      // An empty cell reads as "no risks", which is the opposite of the truth
      // (empty = not assessed). The dash says "no data" like everywhere else;
      // wf_risks_empty_legend spells it out in the legend.
      if (!codes.length) return txt(t("wf_no_data"));
      const wrap = el("div", { class: "wf-hrisks" });
      codes.forEach(function (code) {
        wrap.appendChild(riskBadge(code));
      });
      return wrap;
    });
    table.appendChild(tbody);

    // Full detail for one hour, in plain language, for the selected altitude.
    // Everything here was previously reachable only via hover tooltips.
    function renderHourDetail(h, isAlt) {
      const a = isAlt ? altOf(h, selectedAltitude) || {} : null;
      const hq = qualityCode(isAlt ? a.quality : h.quality);
      const body = el("div", { class: "wf-hd__body" });
      const kvT = function (labelKey, value) {
        if (value != null && value !== "") body.appendChild(kv(labelKey, value));
      };
      // Reason first — the "why" that used to hide in the header tooltip.
      const reason = qReasonText(h.quality_reason);
      if (reason) body.appendChild(el("p", { class: "wf-hd__reason", text: reason }));
      // Temperature + ensemble corridor.
      const temp = isAlt ? a.temp_c : h.temp_base_c;
      const p10 = isAlt ? a.temp_p10_c : h.temp_base_p10_c;
      const p90 = isAlt ? a.temp_p90_c : h.temp_base_p90_c;
      if (temp != null) {
        let s = unit(temp, "°", 0);
        if (num(p10, 1) != null && num(p90, 1) != null)
          s += " · " + t("wf_temp_band", { lo: num(p10, 1), hi: num(p90, 1) });
        kvT("wf_row_temp", s);
      }
      const feels = isAlt ? a.wind_chill_c : h.wind_chill_base_c;
      if (feels != null) kvT("wf_row_chill", unit(feels, "°", 0));
      if (isAlt && a.rh_pct != null)
        kvT("wf_row_rh", a.rh_pct + (a.in_cloud === true ? " · " + t("wf_incloud") : ""));
      // Wind — gusts / p90 are base-only (§4.5).
      if (isAlt) {
        // Gate on the mean (data presence), NOT on the assessed value: in p90
        // mode a null wind_p90_ms must show a dash here, not drop the row.
        if (a.wind_ms != null) {
          const isP90 = f.threshold_mode === "p90";
          const v = assessedWindMs(f, a); // null (p90) → "—"
          let s =
            unit(v, "", 0) +
            (v != null && a.wind_dir_deg != null ? " " + windDir(a.wind_dir_deg) : "");
          if (isP90)
            s += " · " + tg("wf_wind_mean_ctx", { mean: unit(a.wind_ms, "", 0) });
          kvT(
            isP90 ? pickKey("wf_row_wind_alt_p90", "wf_row_wind_alt") : "wf_row_wind_alt",
            s
          );
        }
      } else if (h.wind_base_ms != null) {
        let s =
          unit(h.wind_base_ms, "", 0) +
          (h.wind_gusts_ms != null ? " ⇡" + num(h.wind_gusts_ms, 0) : "");
        const p = [];
        if (h.wind_gusts_p90_basis_ms != null)
          p.push(t("wf_gust_p90", { v: num(h.wind_gusts_p90_basis_ms, 0) }));
        if (p.length) s += " · " + t("wf_spread_prefix") + ": " + p.join(" · ");
        kvT("wf_row_wind", s);
      }
      // Sky / precipitation in words (the header only shows emoji).
      const sky = enumLabel("sky", h.sky_code);
      const precip =
        h.precip_code && h.precip_code !== "none"
          ? enumLabel("precip", h.precip_code)
          : null;
      if (sky || precip) kvT("wf_row_sky", [sky, precip].filter(Boolean).join(" · "));
      if (h.precip_prob_pct != null) kvT("wf_row_prob", String(h.precip_prob_pct));
      // Visibility with worst-case + fog-model context (§4.6).
      const vm = visMeters(h);
      if (vm != null) {
        let s = num(vm / 1000, 1);
        const extra = [];
        if (h.visibility_min_m != null && h.visibility_min_m !== vm)
          extra.push(t("wf_vis_worst", { km: num(h.visibility_min_m / 1000, 1) }));
        if (
          h.visibility_low_models != null &&
          h.visibility_low_models > 0 &&
          h.visibility_models != null
        )
          extra.push(
            t("wf_vis_fog_models", {
              low: h.visibility_low_models,
              total: h.visibility_models,
            })
          );
        if (extra.length) s += " · " + extra.join(" · ");
        kvT("wf_row_visibility", s);
      }
      if (h.freezing_level_m != null) {
        let s = num(h.freezing_level_m, 0);
        if (!freezingVerified(h.freezing_level_source)) {
          const src = h.freezing_level_source;
          const key = "wf_flsource_" + src;
          s += " · " + (src && t(key) !== key ? t(key) : t("wf_flsource_raw_blend"));
        }
        kvT("wf_row_freezing", s);
      }
      if (h.uv_index != null) {
        const info = uvInfo(h.uv_index);
        kvT("wf_row_uv", num(h.uv_index, 0) + " · " + t(info.level));
      }
      const cs = criticalAltState(h);
      if (cs.kind === "bad") kvT("wf_row_critical_alt", num(cs.m, 0));
      else if (cs.kind === "nodata") kvT("wf_row_critical_alt", t("wf_critical_alt_nodata"));
      // Risks — common-hour ∪ selected-altitude.
      const codes = Array.isArray(h.risks) ? h.risks.slice() : [];
      if (isAlt && Array.isArray(a.risks))
        a.risks.forEach(function (c) {
          if (codes.indexOf(c) === -1) codes.push(c);
        });
      if (codes.length) {
        const wrap = el("div", { class: "wf-hrisks" });
        codes.forEach(function (c) {
          wrap.appendChild(riskBadge(c));
        });
        body.appendChild(kv("wf_row_risks", wrap));
      }

      const when = ddmm(h.time_local) + " " + hhmm(h.time_local);
      const backTo = h.time_utc;
      const idx = rows.findIndex(function (x) {
        return x.time_utc === h.time_utc;
      });
      const colFor = hourColFor;
      // Returns focus to the column that opened the panel (see closeDetail).
      function doClose() {
        closeDetail(backTo);
      }
      // Prev/next hour — targeted update: swap only the panel node and the two
      // columns' open state, WITHOUT rebuilding the 73-column table (which would
      // jank on key-repeat). No re-scroll (panel already at the block top).
      function go(delta) {
        if (idx < 0 || !lastData) return;
        const tgt = rows[idx + delta];
        if (!tgt) return;
        const oldC = colFor(detailHour);
        detailHour = tgt.time_utc;
        writeHash(false); // same panel, different hour — not a new back step
        const oldPanel = document.getElementById("wf-hdetail");
        const newPanel = renderHourDetail(tgt, isAlt);
        if (oldPanel) oldPanel.replaceWith(newPanel);
        if (oldC) {
          oldC.classList.remove("wf-hcol--open");
          oldC.setAttribute("aria-expanded", "false");
        }
        if (oldC) oldC.removeAttribute("aria-controls");
        const newC = colFor(tgt.time_utc);
        if (newC) {
          newC.classList.add("wf-hcol--open");
          newC.setAttribute("aria-expanded", "true");
          newC.setAttribute("aria-controls", "wf-hdetail");
          // Keep the timeline in sync: after a few presses the open hour's
          // column had scrolled out of view, so the panel described a column
          // the user could no longer see.
          newC.scrollIntoView({
            inline: "nearest",
            block: "nearest",
            behavior: prefersReducedMotion() ? "auto" : "smooth",
          });
        }
        newPanel.focus({ preventScroll: true });
      }
      const closeBtn = el("button", {
        class: "wf-hd__close",
        text: "✕",
        attrs: { type: "button", "aria-label": t("wf_detail_close") },
      });
      closeBtn.addEventListener("click", doClose);
      const prevBtn = el("button", {
        class: "wf-hd__nav wf-hd__prev",
        text: "‹",
        attrs: {
          type: "button",
          "aria-label": t("wf_detail_prev"),
          title: t("wf_detail_prev"),
        },
      });
      if (idx <= 0) prevBtn.disabled = true;
      else prevBtn.addEventListener("click", function () { go(-1); });
      const nextBtn = el("button", {
        class: "wf-hd__nav wf-hd__next",
        text: "›",
        attrs: {
          type: "button",
          "aria-label": t("wf_detail_next"),
          title: t("wf_detail_next"),
        },
      });
      if (idx < 0 || idx >= rows.length - 1) nextBtn.disabled = true;
      else nextBtn.addEventListener("click", function () { go(1); });
      const head = el("div", { class: "wf-hd__head wf-hq-" + hq }, [
        prevBtn,
        el("span", { class: "wf-hd__when" }, [
          verdictMark(hq),
          document.createTextNode(" " + when + " · "),
          el("span", { class: "wf-hd__verdict", text: t("wf_quality_" + hq) }),
        ]),
        nextBtn,
      ]);
      // Full-width bottom close — a big thumb-reachable target so users don't
      // have to stretch to the top-right ✕ on a large phone.
      const closeBtm = el("button", {
        class: "wf-hd__closebtm",
        text: t("wf_detail_close"),
        attrs: { type: "button" },
      });
      closeBtm.addEventListener("click", doClose);
      const panel = el(
        "section",
        {
          class: "wf-hdetail",
          attrs: { id: "wf-hdetail", tabindex: "-1", role: "region", "aria-label": when },
        },
        [closeBtn, head, body, closeBtm]
      );
      // Arrows navigate hours while focus is inside the panel (scoped, so they
      // don't hijack the timeline's horizontal scroll); preventDefault stops the
      // page from scrolling on the key.
      panel.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          doClose();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        }
      });
      return panel;
    }

    // The timeline is a horizontally scrollable region: without tabindex/role it
    // could not be scrolled from the keyboard at all.
    const timeline = el(
      "div",
      {
        class: "wf-timeline",
        attrs: {
          tabindex: "0",
          role: "region",
          "aria-label": t("wf_hourly_caption"),
        },
      },
      table
    );

    // Jump row: 73 columns were navigable only by pixel-swiping, which fights
    // the page's vertical scroll on a phone. One button per day boundary, plus
    // "now".
    const jump = el(
      "div",
      {
        class: "wf-jump",
        // The visible label is only a visual association; name the group so it
        // is announced as one.
        attrs: { role: "group", "aria-label": t("wf_jump_label") },
      },
      [el("span", { class: "wf-jump__label", text: t("wf_jump_label") })]
    );
    jumpTargets.forEach(function (target) {
      const b = el("button", {
        class: "wf-jumpbtn",
        text: target.label,
        attrs: { type: "button" },
      });
      b.addEventListener("click", function () {
        timeline.scrollTo({
          left: colOffset(timeline, target.th),
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      });
      jump.appendChild(b);
    });

    // Visible horizontal-scroll affordance. The <caption> is sr-only and the
    // hint above talks about tapping, so a user seeing 6–8 columns could
    // reasonably conclude the forecast is 8 hours long.
    // The separator text node matters: without it textContent glues the two
    // halves into "← swipeforecast for 3 days →" for screen readers.
    const scrollHint = el("p", { class: "wf-scrollhint" }, [
      el("span", { text: t("wf_scroll_hint_left") }),
      document.createTextNode(" "),
      el("span", { text: t("wf_scroll_hint_right") }),
    ]);

    const cardKids = [
      el("p", { class: "wf-sub", text: t("wf_alt_select") }),
      seg,
      el("p", { class: "wf-note wf-detail-hint", text: t("wf_detail_hint") }),
      jump,
      scrollHint,
      timeline,
    ];
    // Hour-detail panel (tap a column) — all the per-cell detail that used to be
    // hover-only tooltips, in plain language, for the selected altitude. Sits
    // UNDER the timeline: at the top it pushed the table off-screen whenever the
    // panel was scrolled into view, killing hour-to-hour comparison. Survives
    // re-render via the detailHour state. Isolated in try/catch so a panel
    // failure can't take down the whole timeline.
    if (detailHour != null) {
      const dh = rows.find(function (h) {
        return h.time_utc === detailHour;
      });
      if (dh) {
        try {
          cardKids.push(renderHourDetail(dh, isAlt));
        } catch (e) {
          console.error("[weather] hour detail failed", e);
          detailHour = null;
        }
      } else {
        detailHour = null; // hour no longer in data
      }
    }
    // Quality colour-scale legend — the primary at-a-glance code (the header
    // top-border colour) is otherwise unexplained. Swatch + glyph + label.
    const qlegend = el("div", { class: "wf-qlegend" });
    ["ok", "caution", "bad", "severe", "unknown"].forEach(function (q) {
      qlegend.appendChild(
        el("span", { class: "wf-qlegend__item" }, [
          el("span", {
            class: "wf-qlegend__sw " + qualityClass(q),
            attrs: { "aria-hidden": "true" },
          }),
          verdictMark(q),
          document.createTextNode(" " + t("wf_quality_" + q)),
        ])
      );
    });
    // All of the above used to be up to five stacked .wf-note paragraphs — a wall
    // of small print between the table and the next card. One collapsed
    // "how to read this table" block instead; nothing is lost, it's one tap away.
    const legend = el("details", { class: "wf-details" }, [
      el("summary", { class: "wf-details__summary", text: t("wf_legend_details") }),
      el("p", { class: "wf-note", text: t("wf_quality_legend") }),
      qlegend,
      el("p", { class: "wf-note", text: t("wf_nodata_legend") }),
      el("p", { class: "wf-note", text: t("wf_risks_empty_legend") }),
      el("p", { class: "wf-note", text: t("wf_incloud_legend") }),
    ]);
    // Temp corridor legend — only when some cell actually carries a p10/p90 band.
    const bandShown = rows.some(function (h) {
      const a = isAlt ? altOf(h, selectedAltitude) || {} : h;
      const p10 = isAlt ? a.temp_p10_c : h.temp_base_p10_c;
      const p90 = isAlt ? a.temp_p90_c : h.temp_base_p90_c;
      return p10 != null && p90 != null;
    });
    if (bandShown) {
      legend.appendChild(el("p", { class: "wf-note", text: t("wf_temp_band_legend") }));
    }
    if (critShown) {
      legend.appendChild(el("p", { class: "wf-note", text: t("wf_critical_alt_legend") }));
    }
    if (feelsShown) {
      legend.appendChild(el("p", { class: "wf-note", text: t("wf_feels_note") }));
    }
    // Explains the "верхняя оценка" wind-row marker and that "—" ≠ calm. The only
    // channel that reaches touch/screen-reader users; shown only in p90 mode.
    if (isAlt && f.threshold_mode === "p90") {
      legend.appendChild(el("p", { class: "wf-note", text: tg("wf_wind_p90_legend") }));
    }
    if (visShown) {
      legend.appendChild(el("p", { class: "wf-note", text: t("wf_vis_legend") }));
    }
    if (flUnverified) {
      legend.appendChild(el("p", { class: "wf-note", text: t("wf_freezing_est_note") }));
    }
    // Placed BEFORE the jump row and the timeline. It is built here because its
    // optional paragraphs depend on flags collected while rendering the rows, but
    // after the timeline it sat behind 73 hour buttons in the tab order: reaching
    // the explanation of the colour code took 73 presses of Tab (WCAG 2.4.1).
    const jumpAt = cardKids.indexOf(jump);
    cardKids.splice(jumpAt < 0 ? cardKids.length : jumpAt, 0, legend);
    return card("wf_hourly", cardKids);
  }

  // The leftmost hour column currently visible in the timeline, by time_utc.
  // Anchoring the scroll restore to an HOUR rather than to a pixel offset is the
  // point: a poll drops the elapsed hour, every column shifts left, and the same
  // scrollLeft then shows a DIFFERENT hour — a silent substitution in a table
  // people make go/no-go calls from.
  function leftmostHour(timeline) {
    if (!timeline) return null;
    const cols = timeline.querySelectorAll(".wf-hcol");
    const x = timeline.scrollLeft;
    for (let i = 0; i < cols.length; i++) {
      const th = cols[i].parentNode;
      if (!th) continue;
      const left = colOffset(timeline, th);
      if (left + th.getBoundingClientRect().width > x) {
        return { h: cols[i].getAttribute("data-h"), delta: left - x };
      }
    }
    return null;
  }

  function renderHourlyInto(f) {
    // Preserve the reading position across re-renders (poll / language /
    // altitude switch) so a user reading +50 h isn't yanked back to the start.
    const prev = document.querySelector("#wf-hourly .wf-timeline");
    const savedScroll = prev ? prev.scrollLeft : 0;
    const anchor = leftmostHour(prev);
    // Focus is destroyed by the full re-render below. Remember what had it —
    // otherwise a background poll silently throws a keyboard user back to
    // <body>, ~75 tab stops away from where they were.
    const active = document.activeElement;
    const oldPanel = document.getElementById("wf-hdetail");
    const panelHadFocus = !!(oldPanel && oldPanel.contains(active));
    const colHadFocus =
      !panelHadFocus && active && active.classList
        ? active.classList.contains("wf-hcol")
          ? active.getAttribute("data-h")
          : null
        : null;
    const altBtnHadFocus = !!(
      active &&
      active.classList &&
      active.classList.contains("wf-alt-btn")
    );
    // The scroll container itself is focusable (tabindex="0") and is how the
    // keyboard reaches all 73 columns; the jump buttons are rebuilt too. Without
    // these, a background poll dumped the user back at <body>.
    const timelineHadFocus = !!(
      active &&
      active.classList &&
      active.classList.contains("wf-timeline")
    );
    let jumpBtnIdx = -1;
    if (active && active.classList && active.classList.contains("wf-jumpbtn")) {
      const jbs = document.querySelectorAll("#wf-hourly .wf-jumpbtn");
      for (let i = 0; i < jbs.length; i++) {
        if (jbs[i] === active) {
          jumpBtnIdx = i;
          break;
        }
      }
    }
    section("wf-hourly", function () {
      return renderHourly(f);
    });
    const next = document.querySelector("#wf-hourly .wf-timeline");
    if (next) {
      let restored = false;
      if (anchor && anchor.h) {
        const col = next.querySelector('.wf-hcol[data-h="' + cssEscape(anchor.h) + '"]');
        if (col && col.parentNode) {
          next.scrollLeft = colOffset(next, col.parentNode) - anchor.delta;
          restored = true;
        }
      }
      if (!restored && savedScroll) next.scrollLeft = savedScroll;
    }
    if (panelHadFocus) {
      const np = document.getElementById("wf-hdetail");
      if (np) np.focus({ preventScroll: true });
    } else if (colHadFocus) {
      const col = document.querySelector(
        '#wf-hourly .wf-hcol[data-h="' + cssEscape(colHadFocus) + '"]'
      );
      if (col) col.focus({ preventScroll: true });
    } else if (altBtnHadFocus) {
      // The altitude buttons are rebuilt too; the active one is the selection.
      const b = document.querySelector("#wf-hourly .wf-alt-btn.active");
      if (b) b.focus({ preventScroll: true });
    } else if (timelineHadFocus) {
      if (next) next.focus({ preventScroll: true });
    } else if (jumpBtnIdx >= 0) {
      // Jump buttons carry no stable id — restore by position (the set is
      // derived from day boundaries and is stable across a poll).
      const jbs = document.querySelectorAll("#wf-hourly .wf-jumpbtn");
      const b = jbs[jumpBtnIdx];
      if (b) b.focus({ preventScroll: true });
    }
  }

  // Barometric (Zambretti) forecast as a card of its own, at the very top.
  // In mode="zambretti" — no internet at the hut, a routine situation here —
  // hourly/window/thunder/night are all absent, so this single line IS the whole
  // forecast. It used to be one kv row inside the technical "Sources" footer,
  // below three screens of "no data".
  function renderPressureFc(f) {
    // ONLY in the offline mode. Hybrid payloads carry a zambretti block too, and
    // showing it there put a 19th-century rule of thumb ("less reliable") above
    // the outing window, duplicating the pressure-drop banner right beside it.
    if (f.mode !== "zambretti") return null;
    if (!f.zambretti || f.zambretti.code == null) return null;
    const zt = enumLabel("zambretti", f.zambretti.code);
    // In this mode the card is the entire forecast — an unknown code must still
    // leave a card saying so, not an empty page.
    if (!zt)
      return card(
        "wf_pressure_fc",
        el("p", { class: "wf-note", text: t("wf_section_nodata") })
      );
    const body = [el("p", { class: "wf-strong", text: zt })];
    if (f.zambretti.calibrated === false)
      body.push(el("p", { class: "wf-note", text: t("wf_uncalibrated") }));
    return card("wf_pressure_fc", body);
  }

  function renderSources(f) {
    const s = f.sources || {};
    const parts = [];
    // "Mode: hybrid (observations + models)" on a payload with neither
    // observations nor an hourly series claims a working pipeline that plainly
    // isn't there. Report the effective state instead of the declared one.
    const noPayload = !f.current && !(f.hourly || []).length;
    const modeLbl = noPayload
      ? enumLabel("mode", "unavailable") || t("wf_no_data")
      : enumLabel("mode", f.mode) || t("wf_no_data");
    parts.push(kv("wf_mode", modeLbl));
    if (Array.isArray(s.models_used) && s.models_used.length)
      parts.push(kv("wf_models", s.models_used.join(", ")));
    // Raw backend codes ("ok / degraded", or "? / ?") meant nothing to a reader;
    // localize both, and drop the row entirely when neither status is present.
    // On an UNTRANSLATED code fall back to the code itself rather than the
    // no-data dash: the backend's status vocabulary has already drifted from the
    // contract once (it emits "fresh"/"unavailable"), and here — in the
    // technical footer, not in a risk badge — a raw code is honest, whereas "—"
    // would claim there is no status at all. Absent value still reads "—".
    function statusText(group, code) {
      if (code == null) return t("wf_no_data");
      return enumLabel(group, code) || String(code);
    }
    if (s.obs_status != null || s.nwp_status != null) {
      parts.push(
        kv(
          "wf_obs",
          statusText("obsstatus", s.obs_status) +
            " / " +
            statusText("nwpstatus", s.nwp_status)
        )
      );
    }
    const hasTech =
      !!f.generator_version ||
      typeof f.semantics_epoch === "number" ||
      f.threshold_mode != null ||
      typeof s.free_air_anchors === "boolean";
    if (hasTech) {
      // Telemetry, not user-facing weather: "Версия: gen 0.15.0" and "Эпоха
      // данных: 2" mean nothing to a climber. Kept (they make a prod report
      // traceable) but folded away.
      const tech = el("details", { class: "wf-details" }, [
        el("summary", { class: "wf-details__summary", text: t("wf_tech_details") }),
      ]);
      // Which wind the risk assessment used this cycle (contract 0.15.0). The
      // service self-downgrades an insufficient ensemble to "mean", so an unknown
      // value is shown as "mean" rather than blank; null = no alpine layer → hide.
      const thm =
        f.threshold_mode === "p90" ? "p90" : f.threshold_mode == null ? null : "mean";
      if (thm)
        tech.appendChild(
          kv("wf_threshold", enumLabel("thmode", thm) || t("wf_no_data"))
        );
      // How altitude temperatures were anchored this cycle (station vs free-air).
      if (typeof s.free_air_anchors === "boolean") {
        tech.appendChild(
          kv("wf_freeair", t(s.free_air_anchors ? "wf_freeair_700" : "wf_freeair_station"))
        );
      }
      if (f.generator_version)
        tech.appendChild(kv("wf_version", String(f.generator_version)));
      // Semantics epoch (contract minor ≥1): the "meaning" of the values. Absence
      // ≡ epoch 1; shown only when present so old data stays uncluttered.
      if (typeof f.semantics_epoch === "number")
        tech.appendChild(kv("wf_epoch", String(f.semantics_epoch)));
      parts.push(tech);
    }
    // Mandatory data attribution (CC BY 4.0), small print. Stays OUTSIDE the
    // collapsed block — the CC BY licence requires it to be visible.
    if (Array.isArray(f.attribution) && f.attribution.length) {
      const attr = el("p", { class: "wf-attribution" }, [
        document.createTextNode(t("wf_attribution") + " "),
      ]);
      attr.appendChild(document.createTextNode(f.attribution.join(" · ")));
      parts.push(attr);
    }
    return el("section", { class: "section wf-card wf-sources" }, [
      el("h2", { class: "section_title", text: t("wf_sources") }),
      el("div", { class: "wf-card__body" }, parts),
    ]);
  }

  function renderAll(f) {
    if (!f) return;
    renderUpdated(f);
    try {
      renderBanners(f);
    } catch (e) {
      console.error("[weather] banners failed", e);
    }
    // Order answers the user's actual question first: "do I go, and when?"
    // (window → thunder), then "what is it doing right now?", then the reference
    // material. The DOM slot order in weather-forecast.html matches.
    section("wf-pressure", function () {
      return renderPressureFc(f);
    });
    // With nothing at all in the payload the placeholder cards are suppressed —
    // renderBanners has already said it once, in one banner.
    const bare = allSectionsMissing(f);
    section("wf-window", function () {
      return bare ? null : renderWindow(f);
    });
    section("wf-thunder", function () {
      return bare ? null : renderThunder(f);
    });
    section("wf-current", function () {
      return bare ? null : renderCurrent(f);
    });
    section("wf-night", function () {
      return bare ? null : renderNight(f);
    });
    section("wf-avalanche", function () {
      return renderAvalanche(f);
    });
    section("wf-alpine", function () {
      return renderAlpine(f);
    });
    section("wf-sun", function () {
      return bare ? null : renderSun(f);
    });
    renderHourlyInto(f);
    section("wf-sources", function () {
      return renderSources(f);
    });
  }

  // One error banner, replaced in place. Without the data-err marker every
  // failed poll stacked another identical plaque; an hour offline buried the
  // actual forecast under a wall of them.
  function putErrorBanner(kind, msgKey) {
    const host = document.getElementById("wf-banners");
    if (!host) return;
    const old = host.querySelector('[data-err="1"]');
    if (old) old.parentNode.removeChild(old);
    const b = banner(kind, t(msgKey));
    b.setAttribute("data-err", "1");
    host.insertBefore(b, host.firstChild);
  }

  // First-load variants: the normal error texts promise "the last forecast is
  // still shown", which is a lie on an empty screen — and a user hunting for a
  // forecast that isn't there may read the emptiness as "no hazards".
  const FIRST_LOAD_KEY = {
    wf_err_offline: "wf_err_offline_nodata",
    wf_load_error: "wf_load_error_first",
  };

  function showLoadError(msgKey) {
    let key = msgKey || "wf_load_error";
    // Keep last good data on screen if we have it; otherwise show an error card.
    renderUpdated(lastData || {});
    if (lastData) {
      putErrorBanner("warn", key);
    } else {
      if (FIRST_LOAD_KEY[key] && i18next.exists(FIRST_LOAD_KEY[key]))
        key = FIRST_LOAD_KEY[key];
      // First load failed: clear the "Загрузка прогноза…" info banner (it and the
      // error used to sit on screen together), and report the failure as a
      // banner — writing it into the "Сейчас на станции" card produced
      // "Сейчас на станции: Обновить не удалось", which reads as a statement
      // about the weather station.
      const host = document.getElementById("wf-banners");
      if (host) host.textContent = "";
      putErrorBanner("danger", key);
    }
  }

  function showContractError() {
    // A format problem is not a fetch failure: leaving the previous "refresh
    // failed" plaque up stacks two red banners, one of which now lies (the
    // refresh DID succeed).
    const bhost = document.getElementById("wf-banners");
    if (bhost) {
      const stale = bhost.querySelector('[data-err="1"]');
      if (stale) stale.parentNode.removeChild(stale);
    }
    // If we already have a last-good render on screen, keep it and just warn —
    // wiping it would replace real (if aging) data with nothing. Only clear the
    // sections when there's nothing good to preserve.
    if (lastData) {
      const host = document.getElementById("wf-banners");
      if (host) {
        // Do NOT clear: the storm alarm and the staleness warning live here too,
        // and a format problem is no reason to silence the most important
        // warning on the page. Prepend instead.
        const old = host.querySelector('[data-contract="1"]');
        if (old) old.parentNode.removeChild(old);
        const b = banner("danger", t("wf_contract_kept"));
        b.setAttribute("data-contract", "1");
        host.insertBefore(b, host.firstChild);
      }
      return;
    }
    [
      "wf-pressure",
      "wf-current",
      "wf-alpine",
      "wf-avalanche",
      "wf-window",
      "wf-thunder",
      "wf-night",
      "wf-sun",
      "wf-hourly",
      "wf-sources",
    ].forEach(function (id) {
      set(id, null);
    });
    set("wf-banners", banner("danger", t("wf_contract_error")));
  }

  function showLoading() {
    if (lastData) return; // don't wipe existing data on refetch
    set("wf-banners", banner("info", t("wf_loading")));
  }

  // Map a failure to the key that tells the user what to DO about it. A 404
  // (file not generated) and a timeout on a satellite link call for opposite
  // reactions; one generic "Обновить не удалось" served neither.
  function errorKey(err) {
    const msg = (err && err.message) || "";
    if (err && err.name === "AbortError") return "wf_err_timeout";
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      return "wf_err_offline";
    if (/invalid JSON|empty payload/.test(msg)) return "wf_err_partial";
    if (/HTTP 5/.test(msg)) return "wf_err_server";
    if (/HTTP 4/.test(msg)) return "wf_err_missing";
    // The most common real failure here. A client at the hut is always
    // associated with the access point, so navigator.onLine is practically never
    // false: "no internet" means the uplink died, and fetch rejects with a
    // TypeError whose message differs per browser.
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "wf_err_offline";
    return "wf_load_error";
  }

  // Backoff after a failure. The auto-poll is 20 min away, but the hut's uplink
  // usually returns within 30–90 s; three quick retries cover that without
  // hammering the link. Reset on any success (and on an "online" event).
  function scheduleRetry(key) {
    if (retryTimer != null) return;
    // A 404 means the file has not been generated. wf_err_missing says as much
    // ("refreshing is unlikely to help"), so retrying anyway both contradicts
    // the text and burns the link.
    if (key === "wf_err_missing") return;
    if (retryIdx >= RETRY_MS.length) {
      // wf_err_offline promises "it will update automatically". Once the backoff
      // is spent that promise is void until the next 20-minute poll — say so
      // instead of going quiet.
      if (i18next.exists("wf_retry_stopped"))
        putErrorBanner(lastData ? "warn" : "danger", "wf_retry_stopped");
      return;
    }
    const delay = RETRY_MS[retryIdx++];
    retryTimer = setTimeout(function () {
      retryTimer = null;
      fetchOnce();
    }, delay);
  }

  function cancelRetry() {
    if (retryTimer != null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryIdx = 0;
  }

  // ============================ FETCH ============================

  function fetchOnce(opts) {
    if (inFlight) return; // single-flight
    const manual = !!(opts && opts.manual);
    if (manual) cancelRetry(); // an explicit tap supersedes the pending backoff
    inFlight = true;
    const myseq = ++reqSeq;
    showLoading();
    setRefreshBusy(true);

    const ac = new AbortController();
    const timer = setTimeout(function () {
      ac.abort();
    }, manual ? MANUAL_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS);

    fetch(dataUrl(), { cache: "no-store", signal: ac.signal })
      .then(function (resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.text();
      })
      .then(function (body) {
        if (myseq !== reqSeq) return; // a newer request superseded us
        let f;
        try {
          f = JSON.parse(body);
        } catch (e) {
          throw new Error("invalid JSON");
        }
        if (!f || typeof f !== "object")
          throw new Error("empty payload");
        if (f.contract_version !== CONTRACT) {
          lastError = null;
          console.warn("[weather] unsupported contract_version", f.contract_version);
          showContractError();
          return;
        }
        lastData = f;
        lastOkAt = Date.now();
        lastError = null;
        cancelRetry();
        // One-line positive signal for post-deploy verification in prod console.
        console.info(
          "[weather] contract",
          f.contract_version,
          f.contract_minor,
          f.generator_version,
          "epoch",
          f.semantics_epoch == null ? 1 : f.semantics_epoch,
          "thmode",
          f.threshold_mode
        );
        renderAll(f);
      })
      .catch(function (err) {
        if (myseq !== reqSeq) return;
        console.error("[weather] fetch failed:", err && err.message);
        lastError = err;
        const key = errorKey(err);
        showLoadError(key);
        scheduleRetry(key);
      })
      .finally(function () {
        clearTimeout(timer);
        if (myseq === reqSeq) {
          inFlight = false;
          setRefreshBusy(false);
        }
      });
  }

  // ============================ LIFECYCLE ============================

  function start() {
    if (started) return;
    started = true;
    applyHash(); // restore altitude / open hour from a reloaded or shared URL
    fetchOnce();
    // Poll on a fixed interval, but skip work while the tab is hidden.
    setInterval(function () {
      if (!document.hidden) fetchOnce();
    }, REFETCH_MS);
    // Keep the "N min ago" line honest without touching the network.
    setInterval(tickAge, AGE_TICK_MS);
    // On returning to the tab, refetch only if data is stale enough.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      const ageMs = Date.now() - lastOkAt;
      if (!lastOkAt || ageMs > VISIBLE_REFETCH_MIN * 60000) fetchOnce();
    });
    // The uplink flaps constantly here: react the moment it's back instead of
    // showing an error for the rest of the 20-minute poll interval.
    window.addEventListener("online", function () {
      cancelRetry();
      fetchOnce();
    });
    // System Back / manual fragment edit — adopt the URL and re-render.
    function onNav() {
      const changed = applyHash();
      if (!detailHour) detailPushed = false;
      if (changed && lastData) renderHourlyInto(lastData);
    }
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    // Re-render (no refetch) when the language changes.
    i18next.on("languageChanged", function () {
      if (lastData) renderAll(lastData);
      else renderUpdated({});
    });
  }

  // Gate first render on i18next readiness (init is async).
  if (window.i18next && i18next.isInitialized) start();
  else if (window.i18next) i18next.on("initialized", start);
  else
    document.addEventListener("DOMContentLoaded", function () {
      if (window.i18next) {
        if (i18next.isInitialized) start();
        else i18next.on("initialized", start);
      }
    });

  // Failsafe for a blank page: the entire render is gated on i18next, so if its
  // script fails to load over a flaky satellite link nothing ever renders. Show
  // a static (i18n-independent) loading hint now, and a reload prompt if start()
  // hasn't run in time. Text is trilingual since we can't rely on the bundle.
  (function i18nFailsafe() {
    const host = document.getElementById("wf-banners");
    if (!host) return;
    if (!started && !host.hasChildNodes()) {
      const l = document.createElement("div");
      l.className = "wf-banner wf-banner--info";
      l.textContent = "Загрузка… · Loading… · Жүктөлүүдө…";
      host.appendChild(l);
    }
    setTimeout(function () {
      if (started) return; // a real render took over — nothing to do
      host.textContent = "";
      const d = document.createElement("div");
      d.className = "wf-banner wf-banner--warn";
      d.setAttribute("role", "alert");
      d.textContent =
        "Загружается дольше обычного… Если ничего не появится — обновите страницу. · " +
        "Taking longer than usual… If nothing appears, reload the page. · " +
        "Адаттагыдан узагыраак жүктөлүүдө… Эч нерсе чыкпаса — баракты жаңылаңыз.";
      host.appendChild(d);
      // Must outlast the slowest fetch (25 s manual timeout on the VSAT link):
      // at 12 s this told people to reload while the load was still in flight,
      // restarting it from zero over the same slow channel.
    }, 30000);
  })();
})();
