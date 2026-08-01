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
  const FETCH_TIMEOUT_MS = 8000;
  const STALE_MIN = 40; // client-side "too old" threshold (server flag may be frozen)
  const VISIBLE_REFETCH_MIN = 10; // on tab focus, only refetch if data older than this

  // --- state ---
  let lastData = null; // last successfully parsed payload
  let lastOkAt = 0; // Date.now() of last successful fetch
  let lastError = null; // last fetch/parse error (null when last fetch ok)
  let reqSeq = 0; // monotonic request id — ignore stale responses
  let inFlight = false; // single-flight guard
  let selectedAltitude = "base"; // hourly timeline altitude ("base" | number)
  let detailHour = null; // time_utc of the hour whose detail panel is open, or null
  let started = false;

  function prefersReducedMotion() {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // On opening an hour, glide to the start of the hourly block (the detail panel
  // sits at its top) and move focus into the panel without a second scroll.
  function focusDetail() {
    const host = document.getElementById("wf-hourly");
    if (host)
      host.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    const d = document.getElementById("wf-hdetail");
    if (d) d.focus({ preventScroll: true });
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

  // Localized enum label from a whitelist; missing key -> muted "[code]" + warn.
  function enumLabel(group, code) {
    if (code == null) return null;
    const key = "wf_" + group + "_" + code;
    const s = i18next.t(key);
    if (s === key) {
      console.warn("[weather] missing i18n key:", key);
      return "[" + code + "]";
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

  // Forecast age in minutes. Prefer the server-computed age_minutes: the
  // audience is phones that may be offline with an unsynced clock, and a
  // client-clock calc can make stale data look fresh (or vice versa). Fall
  // back to the client calc only when the server didn't provide age.
  function ageMin(f) {
    if (f && typeof f.age_minutes === "number" && isFinite(f.age_minutes))
      return Math.max(0, Math.floor(f.age_minutes));
    return clientAgeMin(f && f.issued_at_local);
  }

  function tendencyArrow(v) {
    if (v == null) return "→?";
    if (v > 0.1) return "↑";
    if (v < -0.1) return "↓";
    return "→";
  }

  function windArrow(deg) {
    if (deg == null) return "";
    const dirs = ["↓", "↙", "←", "↖", "↑", "↗", "→", "↘"]; // arrow points where wind goes
    return dirs[Math.round(deg / 45) % 8];
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
  // severe keeps ⛔ (NO-GO); caution/bad/unknown get distinct glyphs; ok none.
  const VERDICT_GLYPH = { caution: "⚠", bad: "✕", severe: "⛔", unknown: "?" };
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
    if (m == null) return el("span", { text: "—" });
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
    if (m < 1000) opts.class = "wf-vis-low";
    const node = el("span", opts, km);
    if (foggy) {
      node.appendChild(
        el("sub", {
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
    if (lo != null && hi != null) {
      opts.title = t("wf_temp_band", { lo: lo, hi: hi });
      if (Number(hi) - Number(lo) >= TEMP_BAND_WIDE_C) opts.class = "wf-uncertain";
    }
    const span = el("span", opts);
    if (inCloud === true) {
      span.appendChild(
        el("span", {
          class: "wf-incloud",
          text: " ☁",
          title: t("wf_incloud"),
          attrs: { "aria-hidden": "true" },
        })
      );
    }
    return span;
  }

  // --- section helpers ---
  function card(titleKey, children) {
    return el("section", { class: "section wf-card" }, [
      el("h3", { class: "section_title", text: t(titleKey) }),
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
    return el("span", { class: cls, text: prefix + enumLabel("risk", code) });
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

  function renderUpdated(f) {
    const host = document.getElementById("wf-updated");
    if (!host) return;
    host.textContent = "";
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
    host.textContent = line;
    // Manual refresh — auto-poll can be up to REFETCH_MS away and the channel
    // flaps; give the user an explicit "refresh now" (single-flight guarded).
    host.appendChild(document.createTextNode(" "));
    const btn = el("button", {
      class: "wf-refresh",
      text: "↻",
      attrs: { type: "button", "aria-label": t("wf_refresh"), title: t("wf_refresh") },
    });
    btn.addEventListener("click", function () {
      fetchOnce();
    });
    host.appendChild(btn);
  }

  function renderBanners(f) {
    const host = document.getElementById("wf-banners");
    if (!host) return;
    host.textContent = "";
    const age = ageMin(f);
    if (f.stale || (age != null && age > STALE_MIN)) {
      host.appendChild(
        banner("danger", t("wf_stale", { age: age == null ? "?" : age }))
      );
    }
    if (f.alarm === "storm")
      host.appendChild(banner("danger", enumLabel("alarm", "storm")));
    else if (f.alarm === "deterioration")
      host.appendChild(banner("warn", enumLabel("alarm", "deterioration")));
    if (f.mode && f.mode !== "hybrid") {
      const kind = f.mode === "unavailable" ? "danger" : "warn";
      host.appendChild(banner(kind, enumLabel("mode", f.mode)));
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

  function renderCurrent(f) {
    const c = f.current;
    if (!c) return null;
    const rows = [
      kv("wf_temp", unit(c.temperature_c, "°C", 1)),
      kv(
        "wf_pressure",
        unit(c.pressure_hpa, " hPa", 1) +
          "  " +
          tendencyArrow(c.tendency_hpa_per_3h) +
          (c.tendency_hpa_per_3h == null && c.tendency_unknown_reason
            ? " (" + enumLabel("tendreason", c.tendency_unknown_reason) + ")"
            : "")
      ),
      kv("wf_humidity", unit(c.humidity_pct, "%")),
      kv(
        "wf_cloud",
        unit(c.cloud_cover_pct, "%") +
          (c.fog ? " · " + t("wf_fog") : "")
      ),
    ];
    // "Now" visibility + snow from the current hour (navigation / conditions).
    const h0 = (Array.isArray(f.hourly) && f.hourly[0]) || {};
    if (visMeters(h0) != null) {
      rows.push(kv("wf_row_visibility", visNode(h0)));
    }
    if (h0.snow_depth_cm != null && h0.snow_depth_cm > 0) {
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
    return el("section", { class: "section wf-card wf-warnbox" }, [
      el("h3", { class: "section_title", text: t("wf_alpine_title") }),
      el("p", {
        text:
          enumLabel("alpinestatus", a.status) +
          " — " +
          enumLabel("alpinereason", a.reason),
      }),
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
    if (!av) return null;
    const flags = av.flags || {};
    const list = el("ul", { class: "wf-avlist" });
    AVALANCHE_FLAGS.forEach(function (k) {
      const v = flags[k];
      // 1 → present; 0 → absent; -1 / null / undefined / anything else → no data.
      const state = v === 1 ? "yes" : v === 0 ? "no" : "nodata";
      list.appendChild(
        el("li", { class: "wf-avflag wf-avflag--" + state }, [
          el("span", { class: "wf-avflag__k", text: t("wf_avalanche_flag_" + k) }),
          el("span", { class: "wf-avflag__v", text: t("wf_avalanche_" + state) }),
        ])
      );
    });
    return el("section", { class: "section wf-card wf-warnbox" }, [
      el("h3", { class: "section_title", text: t("wf_avalanche_title") }),
      // The one thing that must always be said: no rating is derivable.
      el("p", { class: "wf-strong", text: t("wf_avalanche_no_rating") }),
      el("p", { class: "wf-sub", text: t("wf_avalanche_flags_intro") }),
      list,
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
    if (!w) return null;
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
            t("wf_window_quality", { q: enumLabel("quality", w.best.quality) }),
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
      body.push(el("p", { text: enumLabel("windowstatus", w.status) }));
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
    if (!th) return null;
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
    if (th.confidence && th.confidence !== "normal")
      body.push(
        el("p", {
          class: "wf-note",
          text: enumLabel("confidence", th.confidence),
        })
      );
    return card("wf_thunder", body);
  }

  function renderNight(f) {
    const n = f.night;
    if (!n) return null;
    const body = [
      el("p", {
        class: "wf-strong",
        text:
          enumLabel("refreeze", n.refreeze) +
          " · " +
          t("wf_rockfall") +
          ": " +
          enumLabel("rockfall", n.rockfall_risk),
      }),
      kv("wf_night_min", unit(n.min_temp_base_c, "°C", 1)),
      kv("wf_freezing_level", unit(n.freezing_level_min_m, " m")),
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
        const lo = num(a.min_temp_c, 1);
        const hi = num(a.p90_c, 1);
        const range =
          lo == null
            ? t("wf_no_data")
            : hi == null
            ? lo + "°"
            : lo + "…" + hi + "°";
        return el("tr", null, [
          el("td", { text: unit(a.altitude_m, " m") }),
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
    if (!s) return null;
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
      return card("wf_hourly", el("p", { text: t("wf_hourly_empty") }));
    }
    const alts = altitudesOf(hourly);
    if (selectedAltitude !== "base" && alts.indexOf(selectedAltitude) === -1) {
      selectedAltitude = "base";
    }
    const isAlt = selectedAltitude !== "base";
    const rows = hourly; // show the full forecast horizon (current hour + 72)

    // altitude selector (theme-aware segmented control)
    const seg = el("div", { class: "wf-altsel" });
    function segBtn(val, label) {
      const b = el("button", {
        class: "wf-alt-btn" + (selectedAltitude === val ? " active" : ""),
        text: label,
        attrs: { type: "button" },
      });
      b.addEventListener("click", function () {
        selectedAltitude = val;
        if (lastData) renderHourlyInto(lastData); // cheap: only the timeline
      });
      return b;
    }
    seg.appendChild(segBtn("base", t("wf_alt_base")));
    alts.forEach(function (m) {
      seg.appendChild(segBtn(m, m + ""));
    });

    // A table with a sticky label column so every number is self-explanatory.
    const table = el("table", { class: "wf-htable" });
    table.appendChild(el("caption", { class: "wf-sr", text: t("wf_hourly_caption") }));

    // Mark day boundaries so 73 hours across ~3 days stay readable.
    const newDayCols = new Set();
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
      const hq =
        (isAlt ? (altOf(h, selectedAltitude) || {}).quality : h.quality) ||
        "unknown";
      const reason = qReasonText(h.quality_reason);
      // Screen-reader verdict: the colour + glyph mean nothing to SR/keyboard.
      // e.g. "NO-GO — опасные порывы". Also makes the reason reachable without
      // the (touch-inaccessible) title tooltip.
      const srVerdict =
        t("wf_quality_" + hq) + (reason ? " — " + reason : "");
      const open = detailHour === h.time_utc;
      // The header is a real button: tap/keyboard opens the hour-detail panel
      // (all the per-cell detail that used to live only in hover tooltips).
      const hbtn = el(
        "button",
        {
          class: "wf-hcol" + (open ? " wf-hcol--open" : ""),
          attrs: {
            type: "button",
            "aria-expanded": open ? "true" : "false",
            "aria-controls": "wf-hdetail",
            "data-h": h.time_utc || "",
          },
        },
        [
          el("span", { class: "wf-sr", text: srVerdict }),
          verdictMark(hq),
          el("div", { class: "wf-hdate", text: showDate ? ddmm(day) : "" }),
          el("div", { class: "wf-hh", text: hhmm(h.time_local) }),
          el("div", {
            class: "wf-hsky",
            text:
              (SKY_GLYPH[h.sky_code] || "") + (PRECIP_GLYPH[h.precip_code] || ""),
            title:
              (enumLabel("sky", h.sky_code) || "") +
              (h.precip_code && h.precip_code !== "none"
                ? " · " + enumLabel("precip", h.precip_code)
                : ""),
          }),
        ]
      );
      hbtn.addEventListener("click", function () {
        detailHour = detailHour === h.time_utc ? null : h.time_utc;
        if (lastData) {
          renderHourlyInto(lastData);
          if (detailHour) focusDetail();
        }
      });
      htr.appendChild(
        el(
          "th",
          {
            class: "wf-hq-" + hq + (newDayCols.has(i) ? " wf-newday" : ""),
            title: reason || undefined,
            attrs: { scope: "col" },
          },
          hbtn
        )
      );
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
      return txt(h.precip_prob_pct != null ? String(h.precip_prob_pct) : "—");
    });
    addRow(isAlt ? "wf_row_wind_alt" : "wf_row_wind", function (h) {
      if (isAlt) {
        const a = altOf(h, selectedAltitude) || {};
        const uncertain = a.wind_ms_spread == null || a.wind_ms_spread > 3;
        const s =
          unit(a.wind_ms, "", 0) +
          (a.wind_dir_deg != null ? " " + windArrow(a.wind_dir_deg) : "");
        return uncertain ? el("span", { class: "wf-uncertain", text: s }) : txt(s);
      }
      // Base station: no direction in the data, but it has gusts. Gusts +
      // ensemble p90 are BASE-only (§4.5) — never labelled onto altitudes.
      const s =
        unit(h.wind_base_ms, "", 0) +
        (h.wind_gusts_ms != null ? " ⇡" + num(h.wind_gusts_ms, 0) : "");
      const p90 = [];
      if (h.wind_base_p90_ms != null)
        p90.push(t("wf_wind_p90", { v: num(h.wind_base_p90_ms, 0) }));
      if (h.wind_gusts_p90_ms != null)
        p90.push(t("wf_gust_p90", { v: num(h.wind_gusts_p90_ms, 0) }));
      return p90.length
        ? el("span", { text: s, title: "p90: " + p90.join(" · ") })
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
        return txt(v != null ? String(v) : "—");
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
      if (h.freezing_level_m == null) return txt("—");
      const v = num(h.freezing_level_m, 0);
      if (freezingVerified(h.freezing_level_source)) return txt(v);
      flUnverified = true;
      const src = h.freezing_level_source;
      const key = "wf_flsource_" + src;
      const title = src && t(key) !== key ? t(key) : t("wf_flsource_raw_blend");
      return el("span", { class: "wf-est", text: v, title: title });
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
          return el("span", { class: "wf-vis-low", text: num(s.m, 0) });
        if (s.kind === "nodata")
          return el("span", { text: "?", title: t("wf_critical_alt_nodata") });
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
        if (v == null) return txt("—");
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
      if (!codes.length) return null;
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
      const hq = (isAlt ? a.quality : h.quality) || "unknown";
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
        if (a.wind_ms != null)
          kvT(
            "wf_row_wind_alt",
            unit(a.wind_ms, "", 0) +
              (a.wind_dir_deg != null ? " " + windArrow(a.wind_dir_deg) : "")
          );
      } else if (h.wind_base_ms != null) {
        let s =
          unit(h.wind_base_ms, "", 0) +
          (h.wind_gusts_ms != null ? " ⇡" + num(h.wind_gusts_ms, 0) : "");
        const p = [];
        if (h.wind_base_p90_ms != null)
          p.push(t("wf_wind_p90", { v: num(h.wind_base_p90_ms, 0) }));
        if (h.wind_gusts_p90_ms != null)
          p.push(t("wf_gust_p90", { v: num(h.wind_gusts_p90_ms, 0) }));
        if (p.length) s += " · p90: " + p.join(" · ");
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
      // Safe attribute-selector value (time_utc is same-origin data, but may hold
      // characters that break a CSS selector).
      const cssEsc =
        typeof CSS !== "undefined" && CSS.escape
          ? CSS.escape
          : function (s) {
              return String(s).replace(/["\\]/g, "\\$&");
            };
      function colFor(tu) {
        return document.querySelector(
          '#wf-hourly .wf-hcol[data-h="' + cssEsc(tu) + '"]'
        );
      }
      // Single close action, shared by the ✕, the bottom button and Esc; returns
      // focus to the column that opened the panel.
      function doClose() {
        detailHour = null;
        if (lastData) {
          renderHourlyInto(lastData);
          const b = colFor(backTo);
          if (b) b.focus();
        }
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
        const oldPanel = document.getElementById("wf-hdetail");
        const newPanel = renderHourDetail(tgt, isAlt);
        if (oldPanel) oldPanel.replaceWith(newPanel);
        if (oldC) {
          oldC.classList.remove("wf-hcol--open");
          oldC.setAttribute("aria-expanded", "false");
        }
        const newC = colFor(tgt.time_utc);
        if (newC) {
          newC.classList.add("wf-hcol--open");
          newC.setAttribute("aria-expanded", "true");
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

    const cardKids = [
      el("p", { class: "wf-sub", text: t("wf_alt_select") }),
      seg,
      el("p", { class: "wf-note wf-detail-hint", text: t("wf_detail_hint") }),
      el("div", { class: "wf-timeline" }, table),
    ];
    // Hour-detail panel (tap a column) — all the per-cell detail that used to be
    // hover-only tooltips, in plain language, for the selected altitude. Placed
    // at the TOP of the block (right under the title) so tapping an hour glides
    // to it; survives re-render via the detailHour state. Isolated in try/catch
    // so a panel failure can't take down the whole timeline.
    if (detailHour != null) {
      const dh = rows.find(function (h) {
        return h.time_utc === detailHour;
      });
      if (dh) {
        try {
          cardKids.unshift(renderHourDetail(dh, isAlt));
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
    cardKids.push(el("p", { class: "wf-note", text: t("wf_quality_legend") }));
    cardKids.push(qlegend);
    // Temp corridor legend — only when some cell actually carries a p10/p90 band.
    const bandShown = rows.some(function (h) {
      const a = isAlt ? altOf(h, selectedAltitude) || {} : h;
      const p10 = isAlt ? a.temp_p10_c : h.temp_base_p10_c;
      const p90 = isAlt ? a.temp_p90_c : h.temp_base_p90_c;
      return p10 != null && p90 != null;
    });
    if (bandShown) {
      cardKids.push(el("p", { class: "wf-note", text: t("wf_temp_band_legend") }));
    }
    if (critShown) {
      cardKids.push(el("p", { class: "wf-note", text: t("wf_critical_alt_legend") }));
    }
    if (feelsShown) {
      cardKids.push(el("p", { class: "wf-note", text: t("wf_feels_note") }));
    }
    if (visShown) {
      cardKids.push(el("p", { class: "wf-note", text: t("wf_vis_legend") }));
    }
    if (flUnverified) {
      cardKids.push(el("p", { class: "wf-note", text: t("wf_freezing_est_note") }));
    }
    return card("wf_hourly", cardKids);
  }

  function renderHourlyInto(f) {
    // Preserve horizontal scroll position across re-renders (poll / language /
    // altitude switch) so a user reading +50h isn't yanked back to the start.
    const prev = document.querySelector("#wf-hourly .wf-timeline");
    const savedScroll = prev ? prev.scrollLeft : 0;
    // If the detail panel currently has focus (arrow-key navigation), the full
    // re-render below destroys it — remember so we can restore focus, otherwise
    // a background poll/language re-render would silently kill the arrow keys.
    const oldPanel = document.getElementById("wf-hdetail");
    const panelHadFocus = !!(
      oldPanel && oldPanel.contains(document.activeElement)
    );
    section("wf-hourly", function () {
      return renderHourly(f);
    });
    if (savedScroll) {
      const next = document.querySelector("#wf-hourly .wf-timeline");
      if (next) next.scrollLeft = savedScroll;
    }
    if (panelHadFocus) {
      const np = document.getElementById("wf-hdetail");
      if (np) np.focus({ preventScroll: true });
    }
  }

  function renderSources(f) {
    const s = f.sources || {};
    const parts = [];
    parts.push(kv("wf_mode", enumLabel("mode", f.mode) || t("wf_no_data")));
    if (Array.isArray(s.models_used) && s.models_used.length)
      parts.push(kv("wf_models", s.models_used.join(", ")));
    parts.push(
      kv(
        "wf_obs",
        (s.obs_status || "?") + " / " + (s.nwp_status || "?")
      )
    );
    // How altitude temperatures were anchored this cycle (station vs free-air).
    if (typeof s.free_air_anchors === "boolean") {
      parts.push(
        kv("wf_freeair", t(s.free_air_anchors ? "wf_freeair_700" : "wf_freeair_station"))
      );
    }
    if (f.zambretti && f.zambretti.code != null) {
      const zt = enumLabel("zambretti", f.zambretti.code);
      parts.push(
        kv(
          "wf_pressure_fc",
          zt + (f.zambretti.calibrated === false ? " · " + t("wf_uncalibrated") : "")
        )
      );
    }
    if (f.generator_version)
      parts.push(kv("wf_version", "gen " + f.generator_version));
    // Mandatory data attribution (CC BY 4.0), small print.
    if (Array.isArray(f.attribution) && f.attribution.length) {
      const attr = el("p", { class: "wf-attribution" }, [
        document.createTextNode(t("wf_attribution") + " "),
      ]);
      attr.appendChild(document.createTextNode(f.attribution.join(" · ")));
      parts.push(attr);
    }
    return el("section", { class: "section wf-card wf-sources" }, [
      el("h3", { class: "section_title", text: t("wf_sources") }),
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
    section("wf-current", function () {
      return renderCurrent(f);
    });
    section("wf-alpine", function () {
      return renderAlpine(f);
    });
    section("wf-avalanche", function () {
      return renderAvalanche(f);
    });
    section("wf-window", function () {
      return renderWindow(f);
    });
    section("wf-thunder", function () {
      return renderThunder(f);
    });
    section("wf-night", function () {
      return renderNight(f);
    });
    section("wf-sun", function () {
      return renderSun(f);
    });
    renderHourlyInto(f);
    section("wf-sources", function () {
      return renderSources(f);
    });
  }

  function showLoadError() {
    // Keep last good data on screen if we have it; otherwise show an error card.
    renderUpdated(lastData || {});
    if (lastData) {
      const host = document.getElementById("wf-banners");
      if (host) {
        const b = banner("warn", t("wf_load_error"));
        host.insertBefore(b, host.firstChild);
      }
    } else {
      set("wf-current", card("wf_now", el("p", { text: t("wf_load_error") })));
    }
  }

  function showContractError() {
    // If we already have a last-good render on screen, keep it and just warn —
    // wiping it would replace real (if aging) data with nothing. Only clear the
    // sections when there's nothing good to preserve.
    if (lastData) {
      const host = document.getElementById("wf-banners");
      if (host) {
        host.textContent = "";
        host.appendChild(banner("danger", t("wf_contract_kept")));
      }
      return;
    }
    ["wf-current","wf-alpine","wf-avalanche","wf-window","wf-thunder","wf-night","wf-sun","wf-hourly","wf-sources"].forEach(function(id){ set(id, null); });
    set("wf-banners", banner("danger", t("wf_contract_error")));
  }

  function showLoading() {
    if (lastData) return; // don't wipe existing data on refetch
    set("wf-banners", banner("info", t("wf_loading")));
  }

  // ============================ FETCH ============================

  function fetchOnce() {
    if (inFlight) return; // single-flight
    inFlight = true;
    const myseq = ++reqSeq;
    showLoading();

    const ac = new AbortController();
    const timer = setTimeout(function () {
      ac.abort();
    }, FETCH_TIMEOUT_MS);

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
        // One-line positive signal for post-deploy verification in prod console.
        console.info(
          "[weather] contract",
          f.contract_version,
          f.contract_minor,
          f.generator_version
        );
        renderAll(f);
      })
      .catch(function (err) {
        if (myseq !== reqSeq) return;
        console.error("[weather] fetch failed:", err && err.message);
        lastError = err;
        showLoadError();
      })
      .finally(function () {
        clearTimeout(timer);
        if (myseq === reqSeq) inFlight = false;
      });
  }

  // ============================ LIFECYCLE ============================

  function start() {
    if (started) return;
    started = true;
    fetchOnce();
    // Poll on a fixed interval, but skip work while the tab is hidden.
    setInterval(function () {
      if (!document.hidden) fetchOnce();
    }, REFETCH_MS);
    // On returning to the tab, refetch only if data is stale enough.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      const ageMs = Date.now() - lastOkAt;
      if (!lastOkAt || ageMs > VISIBLE_REFETCH_MIN * 60000) fetchOnce();
    });
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
      d.className = "wf-banner wf-banner--danger";
      d.setAttribute("role", "alert");
      d.textContent =
        "Не удалось загрузить страницу — обновите. · " +
        "Failed to load — please reload. · " +
        "Жүктөө болбоду — жаңылаңыз.";
      host.appendChild(d);
    }, 12000);
  })();
})();
