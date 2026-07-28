// Weather-forecast page renderer.
// Consumes the station forecast JSON (contract_version 2) and renders it,
// localized via i18next. All values from the JSON go into the DOM through
// textContent/createElement (never innerHTML) — XSS-safe by construction.

(function () {
  "use strict";

  const CONTRACT = 2;
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
  let started = false;

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

  // Standard wind chill (Environment Canada). The JSON gives wind_chill_c only
  // for altitudes, so compute it for the base station from its temp + wind.
  // Applies for T<=10°C and wind>4.8 km/h; otherwise not meaningful → null ("—"),
  // matching how the backend leaves wind_chill_c null when inapplicable.
  function windChill(tempC, windMs) {
    if (tempC == null || windMs == null) return null;
    const kmh = windMs * 3.6;
    if (tempC > 10 || kmh < 4.8) return null;
    const w = Math.pow(kmh, 0.16);
    return 13.12 + 0.6215 * tempC - 11.37 * w + 0.3965 * tempC * w;
  }

  const SKY_GLYPH = { clear: "☀️", partly: "⛅", cloudy: "☁️", overcast: "☁️" };
  const PRECIP_GLYPH = {
    none: "",
    drizzle: "🌦️",
    rain: "🌧️",
    heavy_rain: "⛈️",
    snow: "🌨️",
  };

  function qualityClass(q) {
    if (q === "ok") return "wf-q-ok";
    if (q === "caution") return "wf-q-warn";
    if (q === "bad") return "wf-q-bad";
    return "wf-q-unknown";
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
    return el("div", { class: "wf-banner wf-banner--" + kind, text: text });
  }

  function riskBadge(code) {
    const unknown = /_unknown$/.test(code);
    return el("span", {
      class: "wf-risk" + (unknown ? " wf-risk--unknown" : ""),
      text: (unknown ? "? " : "") + enumLabel("risk", code),
    });
  }

  // ============================ RENDER ============================

  function set(id, node) {
    const host = document.getElementById(id);
    if (!host) return;
    host.textContent = "";
    if (node) host.appendChild(node);
  }

  // Render one section into its slot, isolated so a failure can't blank the page.
  function section(id, fn) {
    try {
      set(id, fn());
    } catch (e) {
      console.error("[weather] section", id, "failed:", e);
      set(id, card("wf_" + id.replace("wf-", ""), el("p", { text: t("wf_no_data") })));
    }
  }

  function renderUpdated(f) {
    const host = document.getElementById("wf-updated");
    if (!host) return;
    host.textContent = "";
    const age = clientAgeMin(f && f.issued_at_local);
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
  }

  function renderBanners(f) {
    const host = document.getElementById("wf-banners");
    if (!host) return;
    host.textContent = "";
    const age = clientAgeMin(f.issued_at_local);
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
      const kind = nte.severity === "warn" ? "warn" : "info";
      host.appendChild(
        banner(kind, t("wf_note_" + nte.code, (nte.params || {})))
      );
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
    ["cape", "levels_600", "levels_500", "precip_prob", "gusts"].forEach(
      function (k) {
        if (a[k] === false) missing.push(t("wf_alpine_" + k));
      }
    );
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

  function renderWindow(f) {
    const w = f.window;
    if (!w) return null;
    const body = [];
    if (w.status === "found" && w.best) {
      body.push(
        el("p", {
          class: "wf-strong",
          text: t("wf_window_best", {
            from: hhmm(w.best.from_local),
            to: hhmm(w.best.to_local),
            hours: w.best.hours == null ? "?" : w.best.hours,
          }),
        })
      );
      if (w.best.quality)
        body.push(
          el("span", {
            class: "wf-chip " + qualityClass(w.best.quality),
            text: enumLabel("quality", w.best.quality),
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
    return card("wf_sun", [
      kv("wf_sunrise", hhmm(s.sunrise_local)),
      kv("wf_sunset", hhmm(s.sunset_local)),
      kv(
        "wf_civil",
        hhmm(s.civil_dawn_local) + " – " + hhmm(s.civil_dusk_local)
      ),
      kv("wf_daylight", unit(s.daylight_hours, " " + t("wf_hours"), 1)),
      el("p", { class: "wf-note", text: t("wf_ridge_note") }),
    ]);
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
      htr.appendChild(
        el(
          "th",
          {
            class:
              "wf-hq-" +
              (h.quality || "unknown") +
              (newDayCols.has(i) ? " wf-newday" : ""),
          },
          [
            el("div", { class: "wf-hdate", text: showDate ? ddmm(day) : "" }),
            el("div", { class: "wf-hh", text: hhmm(h.time_local) }),
            el("div", {
              class: "wf-hsky",
              text:
                (SKY_GLYPH[h.sky_code] || "") +
                (PRECIP_GLYPH[h.precip_code] || ""),
              title:
                (enumLabel("sky", h.sky_code) || "") +
                (h.precip_code && h.precip_code !== "none"
                  ? " · " + enumLabel("precip", h.precip_code)
                  : ""),
            }),
          ]
        )
      );
    });
    table.appendChild(el("thead", null, htr));

    const tbody = el("tbody");
    function addRow(labelKey, cellFn) {
      const tr = el("tr", null, el("th", { text: t(labelKey) }));
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
      const v = isAlt ? (altOf(h, selectedAltitude) || {}).temp_c : h.temp_base_c;
      return txt(unit(v, "°", 0));
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
      // Base station: no direction in the data, but it has gusts.
      return txt(
        unit(h.wind_base_ms, "", 0) +
          (h.wind_gusts_ms != null ? " ⇡" + num(h.wind_gusts_ms, 0) : "")
      );
    });
    // "Feels like": altitudes carry wind_chill_c; for the base we compute it.
    addRow("wf_row_chill", function (h) {
      const v = isAlt
        ? (altOf(h, selectedAltitude) || {}).wind_chill_c
        : windChill(h.temp_base_c, h.wind_base_ms);
      return txt(unit(v, "°", 0));
    });
    addRow("wf_row_freezing", function (h) {
      return txt(h.freezing_level_m != null ? num(h.freezing_level_m, 0) : "—");
    });
    addRow("wf_row_risks", function (h) {
      if (!Array.isArray(h.risks) || !h.risks.length) return null;
      const wrap = el("div", { class: "wf-hrisks" });
      h.risks.forEach(function (code) {
        wrap.appendChild(riskBadge(code));
      });
      return wrap;
    });
    table.appendChild(tbody);

    return card("wf_hourly", [
      el("p", { class: "wf-sub", text: t("wf_alt_select") }),
      seg,
      el("div", { class: "wf-timeline" }, table),
    ]);
  }

  function renderHourlyInto(f) {
    section("wf-hourly", function () {
      return renderHourly(f);
    });
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
    ["wf-current","wf-alpine","wf-window","wf-thunder","wf-night","wf-sun","wf-hourly","wf-sources"].forEach(function(id){ set(id, null); });
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
})();
