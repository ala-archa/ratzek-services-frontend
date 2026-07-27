const languageSlide = document.getElementById("language-slider");

function updateContent() {
  document.querySelectorAll("[data-i18n]").forEach(function (element) {
    const key = element.getAttribute("data-i18n");
    element.innerHTML = i18next.t(key);
  });
}

function updateButtons() {
  const currentLanguage = localStorage.getItem("language") || "ru";
  Array.from(languageSlide.children).forEach((element) => {
    element.classList.remove("active");
    if (element.getAttribute("data-lang") === currentLanguage) {
      element.classList.add("active");
    }
  });
}

function changeLanguage(lng) {
  i18next.changeLanguage(lng, function (err, t) {
    if (err) return console.log("Something went wrong in loading i18n", err);
    updateContent();
    localStorage.setItem("language", lng);
    document.documentElement.lang = lng; // keep <html lang> in sync for a11y/translation
    updateButtons();
  });
}

const savedLanguage = localStorage.getItem("language") || "ru";
document.documentElement.lang = savedLanguage;

i18next.init(
  {
    lng: savedLanguage,
    interpolation: { escapeValue: true },
    resources: {
      en: {
        translation: {
          header_title: "[Internet at Ratsek Hut]",
          title: "Internet at Ratsek Hut",
          connection_error: "Can't reach the access point. Retrying…",
          weather_forecast_local: "Local mountain forecast (Ratzek hut)",
          wf_title: "Weather forecast — Ratzek hut",
          wf_heading: "Weather forecast at Ratzek hut",
          wf_no_data: "—",
          wf_loading: "Loading forecast…",
          wf_load_error: "Couldn't load the forecast. Retrying…",
          wf_contract_error:
            "The forecast format has changed. Please reload the page.",
          wf_updated: "Updated {{time}} · {{age}} min ago",
          wf_updated_unknown: "Update time unknown",
          wf_refresh_failed: "couldn't refresh",
          wf_stale: "Forecast is stale ({{age}} min old)",
          wf_note_station_fog: "Fog at the station right now",
          wf_note_convection_possible:
            "Conditions for convection/thunder (CAPE {{cape_j_kg}}, humidity {{humidity_pct}}%)",
          wf_note_cloud_from_lux:
            "Cloud cover estimated from the light sensor ({{cloud_pct}}%)",
          wf_now: "Now at the station",
          wf_at_station: "Station, {{alt}} m",
          wf_temp: "Temperature",
          wf_pressure: "Pressure",
          wf_humidity: "Humidity",
          wf_cloud: "Cloud cover",
          wf_fog: "fog",
          wf_low_coverage: "sparse observations ({{pct}}%)",
          wf_alpine_title: "High-altitude data",
          wf_alpine_warn:
            "«Not enough data» is not «safe» — treat missing values with caution.",
          wf_alpine_missing: "Missing:",
          wf_alpine_cape: "thunder index",
          wf_alpine_levels_600: "600 hPa level",
          wf_alpine_levels_500: "500 hPa level",
          wf_alpine_precip_prob: "precip probability",
          wf_alpine_gusts: "gusts",
          wf_window: "Weather window",
          wf_window_best: "Best window {{from}}–{{to}} ({{hours}} h)",
          wf_window_closes: "current window closes at {{time}}",
          wf_thunder: "Thunderstorms",
          wf_thunder_likely: "Thunder likely from {{time}}",
          wf_thunder_possible: "Thunder possible from {{time}}",
          wf_thunder_none: "No thunder expected in the next 24 h",
          wf_night: "Coming night",
          wf_rockfall: "rockfall",
          wf_night_min: "Min temp (station)",
          wf_freezing_level: "Freezing level",
          wf_altitude: "Altitude",
          wf_min: "min",
          wf_sun: "Sun",
          wf_sunrise: "Sunrise",
          wf_sunset: "Sunset",
          wf_civil: "Civil twilight",
          wf_daylight: "Daylight",
          wf_hours: "h",
          wf_ridge_note:
            "Astronomical times for 3370 m; behind ridges the real sunrise is later.",
          wf_hourly: "Hourly forecast",
          wf_hourly_empty: "No hourly data in this mode.",
          wf_alt_select: "Altitude for wind/temperature:",
          wf_alt_base: "station",
          wf_wind_ms: "wind, m/s (⇡ gusts)",
          wf_row_temp: "Temperature, °C",
          wf_row_prob: "Precip chance, %",
          wf_row_wind: "Wind, m/s (⇡ gust)",
          wf_row_chill: "Feels like, °C",
          wf_row_freezing: "Freezing level, m",
          wf_row_risks: "Risks",
          wf_sources: "Sources",
          wf_mode: "Mode",
          wf_models: "Models",
          wf_obs: "Obs / NWP",
          wf_pressure_fc: "Pressure forecast",
          wf_uncalibrated: "less reliable (uncalibrated)",
          wf_version: "Version",
          wf_mode_hybrid: "hybrid (obs + models)",
          wf_mode_nwp_only: "models only (no station obs)",
          wf_mode_stale_nwp: "stale model data",
          wf_mode_zambretti:
            "no internet — pressure-only forecast, no hourly data",
          wf_mode_unavailable: "no data available",
          wf_alarm_deterioration: "Pressure alarm: weather deteriorating",
          wf_alarm_storm: "Storm alarm — pressure falling fast",
          wf_tendreason_NoData: "no data",
          wf_tendreason_LowCoverage: "sparse data",
          wf_tendreason_ShortSpan: "span too short",
          wf_tendreason_StaleLatest: "stale reading",
          wf_tendreason_FrozenSensor: "sensor frozen",
          wf_alpinestatus_full: "full",
          wf_alpinestatus_partial: "partial",
          wf_alpinestatus_none: "unavailable",
          wf_alpinereason_ok: "high-altitude data available",
          wf_alpinereason_no_pressure_levels: "no pressure-level data",
          wf_alpinereason_no_cape: "no thunder index",
          wf_quality_ok: "good",
          wf_quality_caution: "caution",
          wf_quality_bad: "bad",
          wf_windowstatus_found: "window found",
          wf_windowstatus_none_in_48h: "no window in the next 48 h",
          wf_windowstatus_insufficient_data:
            "not enough data to find a window",
          wf_confidence_low: "low confidence (no ensemble)",
          wf_confidence_unknown: "confidence unknown (no CAPE)",
          wf_refreeze_yes: "refreeze: yes",
          wf_refreeze_likely: "refreeze: likely",
          wf_refreeze_no: "no refreeze",
          wf_refreeze_unknown: "refreeze: unknown",
          wf_rockfall_low: "low",
          wf_rockfall_elevated: "elevated",
          wf_rockfall_high: "high",
          wf_rockfall_unknown: "unknown",
          wf_risk_thunder_possible: "thunder?",
          wf_risk_thunder_likely: "thunder",
          wf_risk_thunder_unknown: "thunder",
          wf_risk_precip: "precip",
          wf_risk_precip_unknown: "precip",
          wf_risk_wind: "wind",
          wf_risk_wind_unknown: "wind",
          wf_risk_wind_severe: "severe wind",
          wf_risk_whiteout: "whiteout",
          wf_risk_whiteout_unknown: "whiteout",
          wf_risk_cold: "cold",
          wf_risk_cold_unknown: "cold",
          wf_risk_pressure_alarm: "pressure alarm",
          wf_sky_clear: "clear",
          wf_sky_partly: "partly cloudy",
          wf_sky_cloudy: "cloudy",
          wf_sky_overcast: "overcast",
          wf_precip_none: "no precip",
          wf_precip_drizzle: "drizzle",
          wf_precip_rain: "rain",
          wf_precip_heavy_rain: "heavy rain",
          wf_precip_snow: "snow",
          wf_zambretti_1: "Settled fine",
          wf_zambretti_2: "Fine weather",
          wf_zambretti_3: "Fine, becoming less settled",
          wf_zambretti_4: "Fairly fine, showers later",
          wf_zambretti_5: "Showery, becoming more unsettled",
          wf_zambretti_6: "Unsettled, rain later",
          wf_zambretti_7: "Rain at times, worse later",
          wf_zambretti_8: "Rain at times, becoming very unsettled",
          wf_zambretti_9: "Very unsettled, rain",
          wf_zambretti_10: "Settled fine",
          wf_zambretti_11: "Fine weather",
          wf_zambretti_12: "Fine, possibly showers",
          wf_zambretti_13: "Fairly fine, showers likely",
          wf_zambretti_14: "Showery, bright intervals",
          wf_zambretti_15: "Changeable, some rain",
          wf_zambretti_16: "Unsettled, rain at times",
          wf_zambretti_17: "Rain at frequent intervals",
          wf_zambretti_18: "Very unsettled, rain",
          wf_zambretti_19: "Stormy, much rain",
          wf_zambretti_20: "Settled fine",
          wf_zambretti_21: "Fine weather",
          wf_zambretti_22: "Becoming fine",
          wf_zambretti_23: "Fairly fine, improving",
          wf_zambretti_24: "Fairly fine, possibly showers early",
          wf_zambretti_25: "Showery early, improving",
          wf_zambretti_26: "Changeable, mending",
          wf_zambretti_27: "Rather unsettled, clearing later",
          wf_zambretti_28: "Unsettled, probably improving",
          wf_zambretti_29: "Unsettled, short fine intervals",
          wf_zambretti_30: "Very unsettled, finer at times",
          wf_zambretti_31: "Stormy, possibly improving",
          wf_zambretti_32: "Stormy, much rain",
          entry_banner:
            "📶 To get online, please read this page. It only takes about a minute.",
          main_address:
            "You can always return to this page by entering the address",
          main_link: "http://www.ratzek 🚀",
          section_title_always_available:
            "Always available, even without internet",
          section_title_services: "Useful services on the internet",
          section_title_thank_you: "DONATE",
          section_thank_you_button: "Thank you — click!",
          section_title_login: "Login and Statistics",
          section_login_text:
            "The internet is provided for free. To ensure there is enough for everyone, we limit the speed for heavy users. In other words, if you have been using the internet too intensively for a certain period (watching videos, video calls, etc.), your internet speed will slow down for a few hours so that others can also use the service.",
          section_title_about: "About the project",
          section_about_text: "Participated in the project:",
          section_about_button: "More details on how it was created",
          data_meteostation: "Data from the weather station",
          library: "Library of movies and books",
          login_delay_text:
            "And to give you time to read this page, we have added an entry delay",
          weather_forecast: "Weather forecast from Mountain Forecast",
          video_guide: "Video guide by Dmitry Pavlenko",
          community_guide: "Community-created guidebook",
          webcam_archive: "Webcam archive (2 weeks)",
          telegram_chat: "Telegram chat",
          webcam: "Webcam",
          summitx_aksay: '<a href="https://summitx.info/en/objects/ranges/64824505/about">Ak-Sai on SummitX.info</a>',
          summitx_routes: '<a href="https://summitx.info/en/routes?region=64824505">Ak-Sai routes on SummitX.info</a>',
          sign_in_button: "Sign in",
          participant_1:
            "Vasily Tsarevsky — designer of power supply controllers, also carried non-standard cargo to the hut.",
          participant_2:
            "Dmitry Dobrokhotov — installation of network equipment on site.",
          participant_3:
            "Dmitry Pavlenko — creator of the stand for the solar panel, helped with purchases and delivery of non-standard cargo.",
          participant_4:
            "Evgeniy Lepikhin — author of the idea, research on site, programming and configuration, installation.",
          participant_5: "Maxim Mesh — helped with wiring.",
          participant_6:
            "Svyatoslav Deev — creator of the site you are currently on.",
          no_internet: "Unfortunately, there is no internet at the moment",
          inactive_status: "Please wait for access",
          client_blacklisted:
            "Unfortunately, internet access is restricted for you",
          unexpected_status: "A temporary error occurred, please try again later",
          data_usage:
            "You have used {{mb_spent}} MB out of {{mb_limit}} MB at unlimited speed. Reset in {{drop_duration}}",
          wait_for_entrance: "Time left until access: {{sec}} s",
          access_granted: "YOU CAN ENTER, CLICK",
          access_active: "✅ Internet connected — you are online",
          request_access: "Requesting access...",
          back_to_home: "Go back to the main page",
          how_to_thank: "How to thank for the internet",
          thank_text1:
            "The service and internet access were created entirely at our own expense. If you want to thank us, you can do it by transferring:",
          thank_option1:
            "Russia, Raiffeisen: card 5100 6914 8277 3300 or by phone number +7(926)146-23-36 (Evgeniy L.)",
          thank_option2:
            "Russia, SBER: card 2202 2036 7774 2167 or by phone number +7(925)792-87-68 (Eliza P.)",
          thank_option3:
            "Kyrgyzstan, Kompanion: wallet on number 0 708-455-499",
          thank_option4: "Kyrgyzstan, KICB: card 5260 5206 0068 4485",
          thank_text2:
            "If these methods do not suit you, you can write to johnlepikhin@gmail.com, we will arrange something :)",
          thank_cash:
            "You can also drop cash into the donation box — the blue box at the bar.",
          about_project_title: "About the project (by Evgeniy Lepikhin)",
          about_project_intro:
            "One summer in 2022, Svyatoslav Deev and I (Evgeniy Lepikhin) were given a ride to Ala-Archa by a man. During our conversation, we found out that he was the director of the Kyrgyz Hydrometeorological Center. We remembered that there was some weather station near Ratsek Hut. A reasonable question arose: 'How do you transmit data from there?'. It turned out that there is local MegaCom reception. Further field research showed that the weather station had long since ceased to function. But the very fact that it was possible to establish communication right near the hut intrigued me greatly.",
          about_project_part1:
            "I bought a Mikrotik LHG dish and installed various software on my phone to receive raw telemetry from a GSM receiver. I ran back and forth across the moraine for a long and painful time. The dish stubbornly showed zero, sometimes demonstrating some residual signal at a loss level. However, the phone in one place showed as much as two bars and -82 dBm. However, neither calls nor at least 2G could be squeezed out.",
          about_project_part2:
            "Okay. It is known that dish antennas do not get along with reflected signals — and there is, of course, no direct line of sight on the moraine. I bought a cheaper, but sector antenna. Again zero. But on the old helicopter pad, right above the stone hut, I caught as much as 3G, but no matter how much I spun — I couldn't squeeze more than 30Kbit/s. Such a speed in modern realities is suitable for the leisurely (tens of seconds) sending of text messages in Telegram and very slow (minutes) loading of simple sites. But it's shameful to offer people this.",
          about_project_part3:
            "And then Vasya Tsarevsky, simultaneously with my colleagues, suggested organizing a radio bridge from the 'phone booth'. I soldered mobile power for the dish and the wifi access point. I went with this junk to the phone booth. Almost losing my fingers from the December frost, without aiming much, I caught 6.5Mbit inbound and 3Mbit outbound. It's a victory! But — there is no electricity at the phone booth, and the radio bridge costs money.",
          about_project_part4:
            "Further research began on the emerging problems. We had the following tasks ahead of us:",
          about_project_tasks:
            "Organizing a radio bridge. None of us are network engineers, so we had to figure it out from scratch. Power supply for the radio bridge. Vasya, being an electronics specialist, actively joined in solving the problem. The channel is still weak, and any connected user will clog it with some torrents. I took on the task of making the service free for everyone, fairly dividing the bandwidth, and providing local services (video, guidebooks, books, forum, etc.). For local services and organizing convenient internet access, a beautiful local site was needed. Svyatoslav took care of it.",
          about_project_part5:
            "It took us the entire fall and winter to solve these problems. I programmed various services, automated their deployment. Created a backend that controls internet access. Vasya actively consulted on the solar panel, power supply, and soldered a whole controller on Arduino. Svyatoslav created the frontend for the captive portal and the main page.",
          about_project_part6:
            "Then an interesting dialogue occurred with Denis Vaulin. He explained that you can't just place and secure a solar panel on the stones. The problem crept up unexpectedly: the solar panel heats up in the sun, and mountain goats love warmth. And they also love to scratch their horns. Therefore, it was strongly recommended to raise the equipment off the ground. At this point, Dima Pavlenko unexpectedly joined our project. He took on the construction of a stand for the solar panel at the phone booth and helped a lot with the transportation of oversized cargo. In addition, there was a problem with snow accumulation, but Vasya calculated that in winter the panel should be installed at an angle of 58 degrees: this will give less energy in summer, but much more efficiently in winter when the daylight hours are very short.",
          about_project_part7:
            "About 30 kilograms of oversized cargo had to be carried up. Vasya and I did this together. Dima Dobrokhotov, who accidentally turned out to be in the right place at the right time with a crimper in his hands, helped with the installation on site.",
          about_project_part8:
            "Future plans? Currently, our repeater operates solely on solar energy. In other words, there is no internet at night. We plan to install a second panel, a battery block, and a charge controller there. Then we will have internet around the clock. The very approximate cost of equipment for the idea is 40 thousand soms.",
          used_equipment_title: "Used equipment",
          used_equipment_intro:
            "The following equipment was purchased for the project:",
          used_equipment_item1: "Mikrotik LHG6 kit — receiving dish.",
          used_equipment_item2: "Mikrotik SXTsq Lite5 2 pcs. — radio bridge",
          used_equipment_item3:
            "Solar panel SM 100-12 P (100W, Polycrystalline)",
          used_equipment_item4:
            "Charge controller Victron BlueSolar MPPT 75/15",
          used_equipment_item5: "Gel battery DTM 1240 L",
          used_equipment_item6:
            "Arduino nano, DC-DC module, high-capacity capacitors, radio components — power controller at the phone booth",
          used_equipment_item7:
            "Raspberry Pi 4 — local services at the hut, traffic control",
          used_equipment_item8:
            "Some USB Wi-Fi network card with an external antenna — distributing internet as widely as possible",
          used_equipment_item9:
            "256GB SSD disk — a more reliable and faster storage method compared to MicroSD, which also serves as the main disk for RPI",
          used_equipment_item10:
            "BMP280 — temperature, pressure, and humidity sensor",
          used_equipment_item11:
            "A bunch of beams, wires, corrugation, mounting corners",
          used_equipment_additional:
            "In addition, a sector MIMO antenna, LTE modem, a couple of DC-DC modules, and a wifi access point had to be purchased for field experiments and research.",
          software_used_title: "Software under the hood",
          software_used_intro:
            "All source codes can be found in our project group on Github. If we talk in more detail:",
          software_used_item1:
            "Raspbian OS — operating system used on Raspberry PI",
          software_used_item2:
            "ipset, iptables, dhcpd, hostapd, bind — internet distribution, network traffic management",
          software_used_item3:
            "Custom backend and frontend for managing the captive portal",
          software_used_item4: "Lemmy — blog",
          software_used_item5:
            "MiniDLNA — media file distribution for those players that support DLNA",
          software_used_item6:
            "Custom mirroring systems for weather forecasts, guidebooks. Based on httrack and yt-dl",
          software_used_item7:
            "Ansible — service deployment system on Raspberry PI",
          software_used_item8:
            "Grafana — displaying beautiful graphs based on weather data and monitoring the internal state of systems",
          software_used_item9:
            "bsbmp-exporter — delivering data from the weather station sensor to the system",
          software_used_item10:
            "mikrotik-exporter — delivering data from antennas to the system",
          software_used_item11:
            "openvpn — possibility to administer the entire system from afar",
          section_title_thank_you: "Thank you",
          section_thank_you_text:
            "We would appreciate partial reimbursement of expenses. The ways to transfer donations are described <a href='/donate.html' class='otherlink' data-i18n='donate_link'>here</a>. About 350 man-hours of work and about 60,000 soms in 2022-2023 prices were invested in the possibility of the internet appearing here. We pay the mobile operator more than 1,000 soms monthly.",
          about_project_task1:
            "Organizing a radio bridge. None of us are network engineers, so we had to figure it out from scratch.",
          about_project_task2:
            "Power supply for the radio bridge. Vasya, being an electronics specialist, actively joined in solving the problem.",
          about_project_task3:
            "The channel is still weak, and any connected user will clog it with some torrents. I took on the task of making the service free for everyone, fairly dividing the bandwidth, and providing local services (video, guidebooks, books, forum, etc.).",
          about_project_task4:
            "For local services and organizing convenient internet access, a beautiful local site was needed. Svyatoslav took care of it.",
        },
      },
      ru: {
        translation: {
          header_title: "[Интернет на хижине Рацека]",
          title: "Интернет на хижине Рацека",
          connection_error:
            "Не удаётся связаться с точкой доступа. Пробуем ещё раз…",
          weather_forecast_local: "Локальный горный прогноз (хижина Рацека)",
          wf_title: "Прогноз погоды — хижина Рацека",
          wf_heading: "Прогноз погоды на хижине Рацека",
          wf_no_data: "—",
          wf_loading: "Загрузка прогноза…",
          wf_load_error: "Не удалось загрузить прогноз. Пробуем ещё раз…",
          wf_contract_error:
            "Формат прогноза изменился. Пожалуйста, обновите страницу.",
          wf_updated: "Обновлено в {{time}} · {{age}} мин назад",
          wf_updated_unknown: "Время обновления неизвестно",
          wf_refresh_failed: "обновить не удалось",
          wf_stale: "Прогноз устарел (данным {{age}} мин)",
          wf_note_station_fog: "На станции сейчас туман",
          wf_note_convection_possible:
            "Условия для конвекции/гроз (CAPE {{cape_j_kg}}, влажность {{humidity_pct}}%)",
          wf_note_cloud_from_lux:
            "Облачность оценена по датчику освещённости ({{cloud_pct}}%)",
          wf_now: "Сейчас на станции",
          wf_at_station: "Станция, {{alt}} м",
          wf_temp: "Температура",
          wf_pressure: "Давление",
          wf_humidity: "Влажность",
          wf_cloud: "Облачность",
          wf_fog: "туман",
          wf_low_coverage: "мало наблюдений ({{pct}}%)",
          wf_alpine_title: "Высотные данные",
          wf_alpine_warn:
            "«Данных не хватает» ≠ «безопасно» — относитесь к пропускам осторожно.",
          wf_alpine_missing: "Отсутствует:",
          wf_alpine_cape: "грозовой индекс",
          wf_alpine_levels_600: "уровень 600 гПа",
          wf_alpine_levels_500: "уровень 500 гПа",
          wf_alpine_precip_prob: "вероятность осадков",
          wf_alpine_gusts: "порывы",
          wf_window: "Окно выхода",
          wf_window_best: "Лучшее окно {{from}}–{{to}} ({{hours}} ч)",
          wf_window_closes: "текущее окно закроется в {{time}}",
          wf_thunder: "Грозы",
          wf_thunder_likely: "Гроза вероятна с {{time}}",
          wf_thunder_possible: "Гроза возможна с {{time}}",
          wf_thunder_none: "Гроз в ближайшие сутки не ожидается",
          wf_night: "Ближайшая ночь",
          wf_rockfall: "камнеопасность",
          wf_night_min: "Мин. температура (станция)",
          wf_freezing_level: "Изотерма 0°",
          wf_altitude: "Высота",
          wf_min: "мин",
          wf_sun: "Солнце",
          wf_sunrise: "Восход",
          wf_sunset: "Закат",
          wf_civil: "Гражданские сумерки",
          wf_daylight: "Световой день",
          wf_hours: "ч",
          wf_ridge_note:
            "Астрономические времена для 3370 м; за гребнями реальный восход позже.",
          wf_hourly: "Почасовой прогноз",
          wf_hourly_empty: "В этом режиме почасовых данных нет.",
          wf_alt_select: "Высота для ветра/температуры:",
          wf_alt_base: "станция",
          wf_wind_ms: "ветер, м/с (⇡ порывы)",
          wf_row_temp: "Температура, °C",
          wf_row_prob: "Вероятн. осадков, %",
          wf_row_wind: "Ветер, м/с (⇡ порыв)",
          wf_row_chill: "Ощущается, °C",
          wf_row_freezing: "Изотерма 0°, м",
          wf_row_risks: "Риски",
          wf_sources: "Источники",
          wf_mode: "Режим",
          wf_models: "Модели",
          wf_obs: "Набл. / модели",
          wf_pressure_fc: "Прогноз по давлению",
          wf_uncalibrated: "менее надёжно (без калибровки)",
          wf_version: "Версия",
          wf_mode_hybrid: "гибрид (наблюдения + модели)",
          wf_mode_nwp_only: "только модели (нет наблюдений станции)",
          wf_mode_stale_nwp: "устаревшие данные моделей",
          wf_mode_zambretti:
            "нет интернета — прогноз только по давлению, без почасовки",
          wf_mode_unavailable: "данных нет",
          wf_alarm_deterioration: "Барический аларм: погода ухудшается",
          wf_alarm_storm: "Штормовой аларм — давление быстро падает",
          wf_tendreason_NoData: "нет данных",
          wf_tendreason_LowCoverage: "мало данных",
          wf_tendreason_ShortSpan: "слишком короткий интервал",
          wf_tendreason_StaleLatest: "устаревшее измерение",
          wf_tendreason_FrozenSensor: "датчик завис",
          wf_alpinestatus_full: "полные",
          wf_alpinestatus_partial: "частичные",
          wf_alpinestatus_none: "недоступны",
          wf_alpinereason_ok: "высотные данные доступны",
          wf_alpinereason_no_pressure_levels: "нет данных барических уровней",
          wf_alpinereason_no_cape: "нет грозового индекса",
          wf_quality_ok: "хорошо",
          wf_quality_caution: "осторожно",
          wf_quality_bad: "плохо",
          wf_windowstatus_found: "окно найдено",
          wf_windowstatus_none_in_48h: "окна в ближайшие 48 ч нет",
          wf_windowstatus_insufficient_data:
            "данных не хватило, чтобы найти окно",
          wf_confidence_low: "низкая уверенность (без ансамбля)",
          wf_confidence_unknown: "уверенность неизвестна (нет CAPE)",
          wf_refreeze_yes: "смерзание: да",
          wf_refreeze_likely: "смерзание: вероятно",
          wf_refreeze_no: "смерзания не будет",
          wf_refreeze_unknown: "смерзание: неизвестно",
          wf_rockfall_low: "низкая",
          wf_rockfall_elevated: "повышенная",
          wf_rockfall_high: "высокая",
          wf_rockfall_unknown: "неизвестно",
          wf_risk_thunder_possible: "гроза?",
          wf_risk_thunder_likely: "гроза",
          wf_risk_thunder_unknown: "гроза",
          wf_risk_precip: "осадки",
          wf_risk_precip_unknown: "осадки",
          wf_risk_wind: "ветер",
          wf_risk_wind_unknown: "ветер",
          wf_risk_wind_severe: "сильный ветер",
          wf_risk_whiteout: "белая мгла",
          wf_risk_whiteout_unknown: "белая мгла",
          wf_risk_cold: "холод",
          wf_risk_cold_unknown: "холод",
          wf_risk_pressure_alarm: "барический аларм",
          wf_sky_clear: "ясно",
          wf_sky_partly: "переменная облачность",
          wf_sky_cloudy: "облачно",
          wf_sky_overcast: "пасмурно",
          wf_precip_none: "без осадков",
          wf_precip_drizzle: "морось",
          wf_precip_rain: "дождь",
          wf_precip_heavy_rain: "сильный дождь",
          wf_precip_snow: "снег",
          wf_zambretti_1: "Устойчивая ясная погода",
          wf_zambretti_2: "Ясная погода",
          wf_zambretti_3: "Ясно, становится менее устойчиво",
          wf_zambretti_4: "Довольно ясно, позже ливни",
          wf_zambretti_5: "Ливни, становится более неустойчиво",
          wf_zambretti_6: "Неустойчиво, позже дождь",
          wf_zambretti_7: "Временами дождь, позже хуже",
          wf_zambretti_8: "Временами дождь, становится очень неустойчиво",
          wf_zambretti_9: "Очень неустойчиво, дождь",
          wf_zambretti_10: "Устойчивая ясная погода",
          wf_zambretti_11: "Ясная погода",
          wf_zambretti_12: "Ясно, возможны ливни",
          wf_zambretti_13: "Довольно ясно, вероятны ливни",
          wf_zambretti_14: "Ливни, прояснения",
          wf_zambretti_15: "Переменно, местами дождь",
          wf_zambretti_16: "Неустойчиво, временами дождь",
          wf_zambretti_17: "Дождь с частыми перерывами",
          wf_zambretti_18: "Очень неустойчиво, дождь",
          wf_zambretti_19: "Штормовая погода, сильный дождь",
          wf_zambretti_20: "Устойчивая ясная погода",
          wf_zambretti_21: "Ясная погода",
          wf_zambretti_22: "Проясняется",
          wf_zambretti_23: "Довольно ясно, улучшается",
          wf_zambretti_24: "Довольно ясно, возможны ранние ливни",
          wf_zambretti_25: "Ранние ливни, улучшается",
          wf_zambretti_26: "Переменно, налаживается",
          wf_zambretti_27: "Скорее неустойчиво, позже прояснения",
          wf_zambretti_28: "Неустойчиво, вероятно улучшение",
          wf_zambretti_29: "Неустойчиво, короткие прояснения",
          wf_zambretti_30: "Очень неустойчиво, временами лучше",
          wf_zambretti_31: "Штормовая погода, возможно улучшение",
          wf_zambretti_32: "Штормовая погода, сильный дождь",
          entry_banner:
            "📶 Чтобы войти в интернет — прочитайте эту страницу. Это займёт всего одну минуту.",
          main_address:
            "Вы всегда можете вернуться на эту страницу, введя адрес",
          main_link: "http://www.ratzek 🚀",
          section_title_always_available: "Всегда доступно, даже без интернета",
          section_title_services: "Полезные сервисы в интернете",
          section_title_thank_you: "Поблагодарить",
          section_thank_you_text:
            "Будем благодарны за частичную компенсацию расходов. Здесь описаны способы перевода донатов. В возможность появления здесь интернета было вложено порядка 350 человеко-часов работы и около 60 000 сомов в ценах 2022-2023 годов. Ежемесячно сотовому оператору мы оплачиваем более 1000 сомов.",
          section_thank_you_button: "Поблагодарить — жми!",
          section_title_login: "Вход и статистика",
          section_login_text:
            "Интернет предоставляется бесплатно. Чтобы его хватало всем, злостным потребителям мы ограничиваем скорость. Иначе говоря, если вы какой-то период времени слишком активно пользовались интернетом (просмотр видео, видео-звонки и т.д.), то ваш интернет станет медленным на несколько часов, чтобы остальные тоже могли воспользоваться сервисом.",
          section_title_about: "О проекте",
          section_about_text: "В проекте принимали участие:",
          section_about_button: "Более подробно о том, как это создавалось",
          data_meteostation: "Данные с метеостанции",
          library: "Библиотека фильмов и книг",
          login_delay_text:
            "А чтобы успели ознакомиться с этой страницей, мы добавили задержку входа.",
          weather_forecast: "Прогноз погоды от Mountain Forecast",
          video_guide: "Видеогайд от Дмитрия Павленко",
          community_guide: "Созданный сообществом гайдбук",
          webcam_archive: "Архив веб-камеры (2 недели)",
          telegram_chat: "Чат в Telegram",
          webcam: "Веб-камера",
          summitx_aksay: '<a href="https://summitx.info/ru/objects/ranges/64824505/about">Ак-Сай на сайте SummitX.info</a>',
          summitx_routes: '<a href="https://summitx.info/ru/routes?region=64824505">Маршруты Ак-Сая на сайте SummitX.info</a>',
          sign_in_button: "Войти",
          participant_1:
            "Василий Царевский — проектировщик контроллеров электроснабжения, а также заносил негабаритный груз на хижину.",
          participant_2:
            "Дмитрий Доброхотов — монтаж сетевого оборудования на месте.",
          participant_3:
            "Дмитрий Павленко — создатель стойки для солнечной панели, помощь с закупками и доставкой негабарита.",
          participant_4:
            "Евгений Лепихин — автор идеи, исследование на местности, программирование и настройка, монтаж.",
          participant_5: "Максим Меш — помог с распайкой проводов.",
          participant_6:
            "Святослав Деев — создатель сайта, где вы сейчас находитесь.",
          no_internet: "К сожалению, интернета в данный момент нет",
          inactive_status: "Пожалуйста, подождите доступа",
          client_blacklisted:
            "К сожалению, для вас ограничена возможность выхода в интернет",
          unexpected_status: "Временная ошибка. Попробуйте позже",
          data_usage:
            "Вы израсходовали {{mb_spent}} МБ из {{mb_limit}} МБ на безлимитной скорости. До сброса счётчика осталось {{drop_duration}}",
          wait_for_entrance: "Осталось до входа: {{sec}} с",
          access_granted: "МОЖНО ВОЙТИ, ЖМИ",
          access_active: "✅ Интернет подключён — вы в сети",
          request_access: "Запрашиваем доступ...",
          back_to_home: "Вернуться на главную",
          how_to_thank: "Как сказать спасибо за интернет",
          thank_text1:
            "Сервис и доступ в интернет были созданы полностью на собственные средства. Если хотите отблагодарить, это можно сделать переводом:",
          thank_option1:
            "Россия, Raiffeisen: карта 5100 6914 8277 3300 либо по номеру телефона +7(926)146-23-36 (Евгений Л.)",
          thank_option2:
            "Россия, СБЕР: карта 2202 2036 7774 2167 либо по номеру телефона +7(925)792-87-68 (Элиза П.)",
          thank_option3:
            "Кыргызстан, Компаньон: кошелек на номере 0 708-455-499",
          thank_option4: "Кыргызстан, KICB: карта 5260 5206 0068 4485",
          thank_text2:
            "Если эти способы вам не подходят, можете написать на johnlepikhin@gmail.com, договоримся :)",
          thank_cash:
            "Наличные можно опустить в ящик для донатов — синий ящик в баре.",

          about_project_title: "О проекте (от Евгения Лепихина)",
          about_project_intro:
            "Однажды летом 2022 года нас (Святослав Деев и Евгений Лепихин) подвозил в Ала-Арчу какой-то мужик. В процессе разговоров выяснилось, что он директор Кыргызгидметеоцентра. Вспомнили, что рядом с хижиной Рацека находится какая-то метеостанция. Возник резонный вопрос: 'А как вы оттуда передаёте данные?'. Оказалось, что там ловит местный 'Мегаком'. Дальнейшие полевые исследования показали, что метеостанция давно не работает. Но сам факт возможности организации связи прямо около хижины сильно меня заинтриговал.",
          about_project_part1:
            "Купил тарелку Mikrotik LHG, поставил на телефон разный софт, позволяющий получать с GSM-приемника сырую телеметрию. Долго и мучительно бегал по морене туда-сюда. Тарелка упорно показывала ноль, иногда демонстрируя какой-то остаточный сигнал на уровне потери. Зато телефон в одном месте показал аж целых две палки и -82 dBm. Правда, ни звонков, ни тем более хотя бы 2G выжать никак не удавалось.",
          about_project_part2:
            "Ладно. Известно, что антенны типа тарелок не дружат с отраженным сигналом — а прямой видимости на морене конечно же нет. Купил антенну подешевле, зато секторную. Опять ноль. Зато на старой вертолетке, прямо над каменной хижиной, поймал аж 3G, однако сколько бы я ни крутился — скорость выше 30Kbit/s выжать не получалось. Такая скорость в современных реалиях подойдёт для неспешной (десятки секунд) отправки текстовых сообщений в Telegram, и очень медленной (минуты) загрузки простых сайтов. Но такое людям предлагать стыдно.",
          about_project_part3:
            "И вот Вася Царевский одновременно с моими коллегами предложили организовать радиомост со 'звонилки'. Спаял мобильное питание для тарелки и wifi-точки доступа. Сходил с этим барахлом на звонилку. Чуть не лишившись пальцев от морозов декабря, особо не целясь поймал 6.5Mbit на вход и 3Mbit на выход. Это победа! Но — на 'звонилке' нет электричества, да и радиомост стоит денег.",
          about_project_part4:
            "Дальше начались изыскания по возникшим проблемам. Перед нами стояли задачи:",
          about_project_tasks:
            "Организация радиомоста. Никто из нас не является сетевым инженером, пришлось разбираться с нуля. Питание для радиомоста. Вася, будучи электронщиком, активно подключился к решению проблемы. Канал всё равно слабый, и любой подключившийся завалит его какими-нибудь торрентами. Этой задачей занялся я. Поставил себе задачу сделать сервис бесплатный для всех, справедливо делящий полосу, предоставляющий локальные сервисы (видео, гайдбуки, книги, форум и т.д.). Для локальных сервисов и организации удобного доступа в интернет нужен был красивый локальный сайт. Им занялся Святослав.",
          about_project_part5:
            "На решение этих задач у нас ушли осень и вся зима. Я напрограммировал всяких сервисов, автоматизировал их разворачивание. Создал бэкенд, управляющий доступом в интернет. Вася активно консультировал по солнечной панели, питанию, и спаял аж целый контроллер на Arduino. Святослав сделал <a href='https://github.com/ala-archa/ratzek-services-frontend'>фронтенд</a> для captive portal и вообще главную страницу.",
          about_project_part6:
            "Дальше случился интересный диалог с Денисом Ваулиным. Он пояснил, что нельзя просто так взять, поставить и закрепить солнечную панель на камнях. Проблема подкралась с неожиданной стороны: солнечная панель нагревается на солнце, а горные козлы любят тепло. А ещё они любят чесать рога. Поэтому настоятельно рекомендовано было поднять оборудование над землей. И тут к нашему проекту неожиданно присоединился Дима Павленко, который взял на себя строительство стойки для солнечной панели на 'звонилке' и здорово помог с транспортировкой негабаритного груза. Кроме того, была проблема оседания снега, но Вася посчитал, что зимой панель надо ставить под углом 58 градусов: это даст меньше энергии летом, но куда более эффективно зимой, когда световой день очень короткий.",
          about_project_part7:
            "Наверх пришлось занести порядка 30 килограммов негабаритного груза. Этим занялись мы вдвоем с Васей. С монтажом на месте помог Дима Доброхотов, который случайно оказался в нужном месте в нужное время с кримпером в руках.",
          about_project_part8:
            "Планы дальше? Сейчас у нас ретранслятор работает исключительно на солнечной энергии. Иначе говоря, ночью интернета нет. В планах поставить туда вторую панель, блок аккумуляторов и контроллер заряда. Тогда у нас будет интернет круглосуточно. Очень ориентировочная стоимость оборудования для идеи — 40 тысяч сомов.",
          used_equipment_title: "Использованное оборудование",
          used_equipment_intro: "Для проекта было куплено оборудование:",
          used_equipment_item1: "Mikrotik LHG6 kit — приемная тарелка.",
          used_equipment_item2: "Mikrotik SXTsq Lite5 2 шт. — радиомост",
          used_equipment_item3:
            "Солнечная панель SM 100-12 P (100Вт, поликристалл)",
          used_equipment_item4:
            "Контроллер заряда Victron BlueSolar MPPT 75/15",
          used_equipment_item5: "Гелевый аккумулятор DTM 1240 L",
          used_equipment_item6:
            "Arduino nano, DC-DC модуль, конденсаторы высокой емкости, рассыпуха радиодеталей — контроллер питания на 'звонилке'",
          used_equipment_item7:
            "Raspberry Pi 4 — локальные сервисы в хижине, контроль трафика",
          used_equipment_item8:
            "Какая-то USB Wi-Fi сетевая карта с внешней антенной — раздача интернета насколько возможно широко",
          used_equipment_item9:
            "SSD диск на 256GB — более надежный и быстрый по сравнению с MicroSD способ хранения данных, который также служит главным диском для RPI",
          used_equipment_item10:
            "BMP280 — датчик температуры, давления и влажности",
          used_equipment_item11:
            "Куча бруса, проводов, гофры, уголки для монтажа",
          used_equipment_additional:
            "Кроме этого, для экспериментов и изысканий на местности пришлось купить секторную MIMO антенну, LTE-модем, пару DC-DC модулей, wifi-точку доступа.",
          software_used_title: "Софт под капотом",
          software_used_intro:
            "Все исходники можно найти в нашей группе проектов на <a href='https://github.com/ala-archa'>Github</a>. Если говорить подробнее:",
          software_used_item1:
            "Raspbian OS — использованная операционная система на Raspberry PI",
          software_used_item2:
            "ipset, iptables, dhcpd, hostapd, bind — раздача интернета, управление сетевым трафиком",
          software_used_item3:
            "Самописный бэкенд и фронтенд для управления captive порталом",
          software_used_item4: "Lemmy — блог",
          software_used_item5:
            "MiniDLNA — раздача медиа-файлов для тех плееров, которые умеют DLNA",
          software_used_item6:
            "Самописные системы зеркалирования прогноза погоды, гайдбуков. Основаны на httrack и yt-dl",
          software_used_item7:
            "Ansible — система разворачивания сервисов на Raspberry PI",
          software_used_item8:
            "Grafana — отображение красивых графиков по данным погоды, а также мониторинг внутреннего состояния систем",
          software_used_item9:
            "bsbmp-exporter — поставка данных с датчика метеостанции в систему",
          software_used_item10:
            "mikrotik-exporter — поставка данных с антенн в систему",
          software_used_item11:
            "openvpn — возможность администрирования всей системой с большой земли",
          section_title_thank_you: "Поблагодарить",
          section_thank_you_text:
            "Будем благодарны за частичную компенсацию расходов. <a href='/donate.html' class='otherlink' data-i18n='donate_link'>Здесь</a> описаны способы перевода донатов. В возможность появления здесь интернета было вложено порядка 350 человеко-часов работы и около 60 000 сомов в ценах 2022-2023 годов. Ежемесячно сотовому оператору мы оплачиваем более 1000 сомов.",
          section_thank_you_button: "Поблагодарить — жми!",

          about_project_task1:
            "Организация радиомоста. Никто из нас не является сетевым инженером, пришлось разбираться с нуля.",
          about_project_task2:
            "Питание для радиомоста. Вася, будучи электронщиком, активно подключился к решению проблемы.",
          about_project_task3:
            "Канал всё равно слабый, и любой подключившийся завалит его какими-нибудь торрентами. Этой задачей занялся я. Поставил себе задачу сделать сервис, бесплатный для всех, справедливо делящий полосу, предоставляющий локальные сервисы (видео, гайдбуки, книги, форум и т.д.).",
          about_project_task4:
            "Для локальных сервисов и организации удобного доступа в интернет нужен был красивый локальный сайт. Им занялся Святослав.",
        },
      },
      kg: {
        translation: {
          header_title: "[Рацек Хижинасындагы Интернет]",
          title: "Рацек Хижинасындагы Интернет",
          connection_error:
            "Байланыш түйүнүнө жетүү мүмкүн эмес. Кайра аракет кылып жатабыз…",
          weather_forecast_local:
            "Жергиликтүү тоо аба ырайы божомолу (Рацек хижинасы)",
          wf_title: "Аба ырайы божомолу — Рацек хижинасы",
          wf_heading: "Рацек хижинасындагы аба ырайы божомолу",
          wf_no_data: "—",
          wf_loading: "Божомол жүктөлүүдө…",
          wf_load_error:
            "Божомолду жүктөө мүмкүн болбоду. Кайра аракет кылып жатабыз…",
          wf_contract_error: "Божомолдун форматы өзгөрдү. Баракты жаңылаңыз.",
          wf_updated: "Жаңыланды {{time}} · {{age}} мүнөт мурун",
          wf_updated_unknown: "Жаңылоо убактысы белгисиз",
          wf_refresh_failed: "жаңылоо мүмкүн болбоду",
          wf_stale: "Божомол эскирген ({{age}} мүнөт болду)",
          wf_note_station_fog: "Станцияда азыр туман",
          wf_note_convection_possible:
            "Конвекция/чагылган шарттары (CAPE {{cape_j_kg}}, нымдуулук {{humidity_pct}}%)",
          wf_note_cloud_from_lux:
            "Булуттуулук жарык сенсору боюнча бааланган ({{cloud_pct}}%)",
          wf_now: "Азыр станцияда",
          wf_at_station: "Станция, {{alt}} м",
          wf_temp: "Температура",
          wf_pressure: "Басым",
          wf_humidity: "Нымдуулук",
          wf_cloud: "Булуттуулук",
          wf_fog: "туман",
          wf_low_coverage: "байкоолор аз ({{pct}}%)",
          wf_alpine_title: "Бийиктик маалыматтары",
          wf_alpine_warn:
            "«Маалымат жетишсиз» ≠ «коопсуз» — жоктукка этият болуңуз.",
          wf_alpine_missing: "Жок:",
          wf_alpine_cape: "чагылган индекси",
          wf_alpine_levels_600: "600 гПа деңгээли",
          wf_alpine_levels_500: "500 гПа деңгээли",
          wf_alpine_precip_prob: "жаан-чачын ыктымалдыгы",
          wf_alpine_gusts: "шамал соккулары",
          wf_window: "Чыгуу терезеси",
          wf_window_best: "Эң жакшы терезе {{from}}–{{to}} ({{hours}} с)",
          wf_window_closes: "учурдагы терезе {{time}} жабылат",
          wf_thunder: "Чагылгандар",
          wf_thunder_likely: "Чагылган {{time}} тартып ыктымал",
          wf_thunder_possible: "Чагылган {{time}} тартып мүмкүн",
          wf_thunder_none: "Жакынкы бир сутка чагылган күтүлбөйт",
          wf_night: "Жакынкы түн",
          wf_rockfall: "таш кулоо коркунучу",
          wf_night_min: "Мин. температура (станция)",
          wf_freezing_level: "0° изотерма",
          wf_altitude: "Бийиктик",
          wf_min: "мин",
          wf_sun: "Күн",
          wf_sunrise: "Күн чыгуу",
          wf_sunset: "Күн батуу",
          wf_civil: "Жарандык иңир",
          wf_daylight: "Күндүзгү жарык",
          wf_hours: "с",
          wf_ridge_note:
            "3370 м үчүн астрономиялык убакыт; кырлардын артында чыныгы күн чыгуу кечирээк.",
          wf_hourly: "Сааттык божомол",
          wf_hourly_empty: "Бул режимде сааттык маалымат жок.",
          wf_alt_select: "Шамал/температура үчүн бийиктик:",
          wf_alt_base: "станция",
          wf_wind_ms: "шамал, м/с (⇡ соккулар)",
          wf_row_temp: "Температура, °C",
          wf_row_prob: "Жаан ыктымал., %",
          wf_row_wind: "Шамал, м/с (⇡ сокку)",
          wf_row_chill: "Сезилет, °C",
          wf_row_freezing: "0° изотерма, м",
          wf_row_risks: "Тобокелдиктер",
          wf_sources: "Булактар",
          wf_mode: "Режим",
          wf_models: "Моделдер",
          wf_obs: "Байкоо / модель",
          wf_pressure_fc: "Басым боюнча божомол",
          wf_uncalibrated: "азыраак ишенимдүү (калибрленбеген)",
          wf_version: "Версия",
          wf_mode_hybrid: "гибрид (байкоо + моделдер)",
          wf_mode_nwp_only: "моделдер гана (станция байкоосу жок)",
          wf_mode_stale_nwp: "эскирген модель маалыматы",
          wf_mode_zambretti:
            "интернет жок — басым боюнча гана божомол, сааттыгы жок",
          wf_mode_unavailable: "маалымат жок",
          wf_alarm_deterioration: "Барикалык дабыл: аба ырайы начарлайт",
          wf_alarm_storm: "Шторм дабылы — басым тез түшүүдө",
          wf_tendreason_NoData: "маалымат жок",
          wf_tendreason_LowCoverage: "маалымат аз",
          wf_tendreason_ShortSpan: "интервал өтө кыска",
          wf_tendreason_StaleLatest: "эскирген өлчөө",
          wf_tendreason_FrozenSensor: "сенсор катып калган",
          wf_alpinestatus_full: "толук",
          wf_alpinestatus_partial: "жарым-жартылай",
          wf_alpinestatus_none: "жеткиликсиз",
          wf_alpinereason_ok: "бийиктик маалыматтары бар",
          wf_alpinereason_no_pressure_levels: "барикалык деңгээл маалыматы жок",
          wf_alpinereason_no_cape: "чагылган индекси жок",
          wf_quality_ok: "жакшы",
          wf_quality_caution: "этият",
          wf_quality_bad: "начар",
          wf_windowstatus_found: "терезе табылды",
          wf_windowstatus_none_in_48h: "жакынкы 48 саатта терезе жок",
          wf_windowstatus_insufficient_data:
            "терезе табууга маалымат жетишсиз",
          wf_confidence_low: "төмөн ишеним (ансамблсиз)",
          wf_confidence_unknown: "ишеним белгисиз (CAPE жок)",
          wf_refreeze_yes: "тоңуу: ооба",
          wf_refreeze_likely: "тоңуу: ыктымал",
          wf_refreeze_no: "тоңуу болбойт",
          wf_refreeze_unknown: "тоңуу: белгисиз",
          wf_rockfall_low: "төмөн",
          wf_rockfall_elevated: "жогорулаган",
          wf_rockfall_high: "жогорку",
          wf_rockfall_unknown: "белгисиз",
          wf_risk_thunder_possible: "чагылган?",
          wf_risk_thunder_likely: "чагылган",
          wf_risk_thunder_unknown: "чагылган",
          wf_risk_precip: "жаан-чачын",
          wf_risk_precip_unknown: "жаан-чачын",
          wf_risk_wind: "шамал",
          wf_risk_wind_unknown: "шамал",
          wf_risk_wind_severe: "катуу шамал",
          wf_risk_whiteout: "ак туман",
          wf_risk_whiteout_unknown: "ак туман",
          wf_risk_cold: "суук",
          wf_risk_cold_unknown: "суук",
          wf_risk_pressure_alarm: "барикалык дабыл",
          wf_sky_clear: "ачык",
          wf_sky_partly: "аз булуттуу",
          wf_sky_cloudy: "булуттуу",
          wf_sky_overcast: "бүркөк",
          wf_precip_none: "жаан-чачынсыз",
          wf_precip_drizzle: "чачыранды жаан",
          wf_precip_rain: "жаан",
          wf_precip_heavy_rain: "катуу жаан",
          wf_precip_snow: "кар",
          wf_zambretti_1: "Туруктуу ачык аба ырайы",
          wf_zambretti_2: "Ачык аба ырайы",
          wf_zambretti_3: "Ачык, туруксуздана баштайт",
          wf_zambretti_4: "Салыштырмалуу ачык, кийин нөшөр",
          wf_zambretti_5: "Нөшөрлүү, туруксуздана баштайт",
          wf_zambretti_6: "Туруксуз, кийин жаан",
          wf_zambretti_7: "Убакыт-убакыт жаан, кийин начарлайт",
          wf_zambretti_8: "Убакыт-убакыт жаан, абдан туруксуздана баштайт",
          wf_zambretti_9: "Абдан туруксуз, жаан",
          wf_zambretti_10: "Туруктуу ачык аба ырайы",
          wf_zambretti_11: "Ачык аба ырайы",
          wf_zambretti_12: "Ачык, нөшөр мүмкүн",
          wf_zambretti_13: "Салыштырмалуу ачык, нөшөр ыктымал",
          wf_zambretti_14: "Нөшөрлүү, ачылуулар",
          wf_zambretti_15: "Өзгөрмө, жер-жерде жаан",
          wf_zambretti_16: "Туруксуз, убакыт-убакыт жаан",
          wf_zambretti_17: "Тез-тез үзгүлтүк менен жаан",
          wf_zambretti_18: "Абдан туруксуз, жаан",
          wf_zambretti_19: "Шторм, катуу жаан",
          wf_zambretti_20: "Туруктуу ачык аба ырайы",
          wf_zambretti_21: "Ачык аба ырайы",
          wf_zambretti_22: "Ачылып жатат",
          wf_zambretti_23: "Салыштырмалуу ачык, жакшырат",
          wf_zambretti_24: "Салыштырмалуу ачык, эрте нөшөр мүмкүн",
          wf_zambretti_25: "Эрте нөшөр, жакшырат",
          wf_zambretti_26: "Өзгөрмө, оңолуп жатат",
          wf_zambretti_27: "Тескерисинче туруксуз, кийин ачылуулар",
          wf_zambretti_28: "Туруксуз, жакшырышы ыктымал",
          wf_zambretti_29: "Туруксуз, кыска ачылуулар",
          wf_zambretti_30: "Абдан туруксуз, убакыт-убакыт жакшыраак",
          wf_zambretti_31: "Шторм, жакшырышы мүмкүн",
          wf_zambretti_32: "Шторм, катуу жаан",
          entry_banner:
            "📶 Интернетке кирүү үчүн бул баракты окуп чыгыңыз. Бул болгону бир мүнөт убакытты алат.",
          main_address:
            "Сиз бул бетке ар дайым төмөнкү дарек аркылуу кайтып келсеңиз болот",
          main_link: "http://www.ratzek 🚀",
          section_title_always_available:
            "Интернетсиз дагы ар дайым жеткиликтүү",
          section_title_services: "Интернеттеги пайдалуу кызматтар",
          section_title_thank_you: "Ыраазычылык билдирүү",
          section_thank_you_button: "Ыраазычылык билдирүү — басыңыз!",
          section_title_login: "Кирүү жана статистика",
          section_login_text:
            "Интернет акысыз берилет. Бардыгына жеткиликтүү болушу үчүн, активдүү колдонуучуларга ылдамдыкты чектейбиз. Башкача айтканда, эгер сиз интернетти өтө активдүү колдонсоңуз (видео көрүү, видео чалуулар ж.б.), интернет бир нече саатка жай болот, ошондо башкалар дагы пайдалана алышат. Бул бет менен таанышууга убакыт бериши үчүн, кирүү кечиктирүүнү коштук.",
          section_title_about: "Долбоор жөнүндө",
          section_about_text: "Долбоорго катышкандар:",
          section_about_button: "Кантип жаралганын кененирээк",
          data_meteostation: "Метеостанциянын маалыматы",
          library: "Китептер жана тасмалар китепканасы",
          login_delay_text:
            "Жана алардын бул баракча менен таанышууга убактысы болушу үчүн, биз кирүү кечигүүсүн коштук.",
          weather_forecast: "Mountain Forecast боюнча аба ырайынын божомолу",
          video_guide: "Дмитрий Павленконун видеогиди",
          community_guide: "Жамаат тарабынан түзүлгөн гидбук",
          webcam_archive: "Веб-камера архиви (2 жума)",
          telegram_chat: "Telegram чат",
          webcam: "Веб-камера",
          summitx_aksay: '<a href="https://summitx.info/ky/objects/ranges/64824505/about">SummitX.info сайтындагы Ак-Сай</a>',
          summitx_routes: '<a href="https://summitx.info/ky/routes?region=64824505">SummitX.info сайтындагы Ак-Сай маршруттары</a>',
          sign_in_button: "Кирүү",
          participant_1:
            "Василий Царевский — электр жабдууларын долбоорлоочу, ошондой эле хижинага оор жүктү алып келген.",
          participant_2:
            "Дмитрий Доброхотов — жеринде тармактык жабдууларды орноткон.",
          participant_3:
            "Дмитрий Павленко — күн панели үчүн мамы орнотуп, сатып алуу жана оор жүктү жеткирүү боюнча жардам берген.",
          participant_4:
            "Евгений Лепихин — идеянын автору, жеринде изилдөө, программалоо жана орнотуу, монтаждоо иштери менен алектенген.",
          participant_5: "Максим Меш — зымдарды туташтырууга жардам берген.",
          participant_6:
            "Святослав Деев — сиз азыр жүргөн сайттын жаратуучусу.",
          no_internet: "Тилекке каршы, учурда интернет жок",
          inactive_status: "Кирүү үчүн күтө туруңуз",
          client_blacklisted:
            "Тилекке каршы, сиз үчүн интернетке кирүү чектелген",
          unexpected_status:
            "Убактылуу ката. Бир аздан кийин кайра аракет кылыңыз",
          data_usage:
            "Сиз чексиз ылдамдыкта {{mb_spent}} MB колдондуңуз {{mb_limit}} MBдан. Эсептегичти кайра коюуга чейин убакыт калды {{drop_duration}}",
          wait_for_entrance: "Кирүү үчүн калган убакыт: {{sec}} секунд",
          access_granted: "КИРСЕҢИЗ БОЛОТ, БАСЫҢЫЗ",
          access_active: "✅ Интернет туташты — сиз тармактасыз",
          request_access: "Кирүү суралууда...",
          back_to_home: "Башкы бетке кайтуу",
          how_to_thank: "Интернет үчүн ыраазычылык билдирүү",
          thank_text1:
            "Сервис жана интернетке кирүү толугу менен өз эсебибизден түзүлгөн. Эгер ыраазычылык билдиргиңиз келсе, аны акча которуу менен жасай аласыз:",
          thank_option1:
            "Россия, Raiffeisen: карта 5100 6914 8277 3300 же телефон номери боюнча +7(926)146-23-36 (Евгений Л.)",
          thank_option2:
            "Россия, СБЕР: карта 2202 2036 7774 2167 же телефон номери боюнча +7(925)792-87-68 (Элиза П.)",
          thank_option3:
            "Кыргызстан, Компаньон: номеринде капчык 0 708-455-499",
          thank_option4: "Кыргызстан, KICB: карта 5260 5206 0068 4485",
          thank_text2:
            "Эгер бул ыкмалар сизге ылайыктуу болбосо, johnlepikhin@gmail.com жазсаңыз болот, макулдашабыз :)",
          thank_cash:
            "Накталай акчаны донат кутусуна — бардагы көк кутуга салсаңыз болот.",
          about_project_title: "Долбоор жөнүндө (Евгений Лепихин тарабынан)",
          about_project_intro:
            "2022-жылдын жайында Святослав Деев экөөбүздү (Евгений Лепихин) бир киши Ала-Арчага жеткизип калды. Сүйлөшүү учурунда ал 'Кыргызгидромет' борборунун директору экенин билдик. Рацек хижинасынын жанында бир метеостанция бар экенин эстеп, ал адамга 'Сиз ал жактан кантип маалымат жөнөтөсүз?' деген суроо бердик. Көрсө ал жерде жергиликтүү 'Мегаком' тармагы бар экен. Бирок биз изилдеп көрүп, метеостанциянын көптөн бери иштебей калганын билдик. Ошондо хижинанын жанында байланыш уюштуруу мүмкүнчүлүгү мени абдан кызыктырып койду.",
          about_project_part1:
            "Мен Mikrotik LHG табагын сатып алып, телефондун GSM кабылдагычынан чийки телеметрияны алууга мүмкүндүк берген ар кандай программаларды орноттум. Моренанын үстүндө бир топко чейин ары-бери катуу жүгүрдүм. Табак нөлдү көрсөткөн бойдон калды, кээде жоготуу деңгээлинде кандайдыр бир сигналды көрсөтүп жатты. Бирок телефон бир жерде дээрлик эки сызык менен -82 dBm көрсөттү. Чындыгында бир да чалуу кетпеди, жок дегенде 2G да иштебей жатты.",
          about_project_part2:
            "Белгилүү болгондой, табак антенналары чагылдырылган сигналдар менен жакшы иштешпейт. Анын үстүнө моренада сигналдар түз көрүнбөйт. Арзаныраак бирок сектордук антенна сатып алдым. Дагы деле нөлдү көрсөтүп жатты. Бирок, таш хижинанын үстүндөгү эски тик учак аянтында 3G кармай алдым. Анткени менен канча аракет кылсам да, интернет 30Kbit/секунддан ашык чыкпады. Мындай ылдамдык азыркы реалдуулукта Telegram'да тексттик билдирүүлөрдү он чакты секунд ичинде жөнөтүүгө жана жөнөкөй сайттарды мүнөттөр ичинде жүктөөгө ылайыктуу эле. Бирок адамдарга мындай интернет сунуштоо уят болчу.",
          about_project_part3:
            "Андан кийин Василий Царевский менин кесиптештерим телефон бурасынан радиокөпүрө уюштурууну сунуштап калышты. Табакка жана Wi-Fi кирүү чекитине мобилдик кубаттандыргычты ширетип бириктирдим. Декабрдын суугунан манжаларымдан ажырап кала жаздап, 6,5Mbit кирүү жана 3Mbit чыгуу кармадым. Бул жеңиш! Бирок телефон бурасында электр жок эле жана радиокөпүрө акча талап кылчу.",
          about_project_part4:
            "Кийин пайда болгон көйгөйлөр боюнча изилдөөлөр башталды. Биздин алдыбызда төмөнкү милдеттер турган:",
          about_project_tasks:
            "Радиокөпүрөнү уюштуруу. Биздин арабызда эч ким тармак инженери эмес болгондуктан бардыгын нөлдөн үйрөнүүгө туура келди. Радиокөпүрөгө кубат берүү. Вася электроника инженери болгондуктан, көйгөйдү чечүүгө активдүү катышты. Канал дагы эле алсыз жана каалаган колдонуучу аны ар кандай торенттер менен бөгөп коёт болчу. Бул суроону мен чечүүгө бел байладым. Мен бул сервисти бардык адамдарга бекер кылууну чечтим. Аны менен бирге адилет бөлүштүрүүчү жана ар кандай кызматтарды (видео, гидбуктар, китептер, форум ж.б.) камсыз кыла алган сервис уюштурууга максат койдум. Жергиликтүү кызматтар жана интернетке ыңгайлуу жеткиликтүүлүктү уюштуруу үчүн жакшы сайт керек болчу. Аны Святослав ишке ашырды.",
          about_project_part5:
            "Бул маселелерди чечүү үчүн күздөн кышка чейин убактыбыз кетти. Мен ар кандай сервистерди программалап алардын жайылышын автоматташтырдым. Интернетке жетүүнү көзөмөлдөгөн backend түздүм. Вася күн панели, кубаттуулук берүү жана Arduino'да бүтүндөй контроллер жасоо боюнча активдүү консультация берип жатты. Святослав captive порталы үчүн frontend жана башкы баракты жасады.",
          about_project_part6:
            "Мындан кийин Денис Ваулин менен кызыктуу диалог болду. Ал күн панелин таштарга орнотуу жана бекитүү жөнөкөй эмес экенин түшүндүрдү. Көйгөй күтүлбөгөн жерден пайда болду: панел күндө ысып, жылуулукту жакшы көрүшкөн тоо текелерди өзүнө тартат экен. Анан дагы тоо текелер мүйүздөрүн тырмаганды жакшы көрүшөт. Ошондуктан жабдууларды жерден көтөрүү сунушталды. Бул учурда биздин долбоорго Дима Павленко күтүлбөгөн жерден кошулду. Ал телефон бурасындагы күн панели үчүн мамы курууну өзүнө алды жана жүктү жеткирүүдө чоң жардам берди. Мындан тышкары, кардын чөгүшү көйгөй болгон. Бирок Василий кышында панелди 58 градус бурчта коюу керек деп чечти: мындай ыкма жайында азыраак энергия берет, бирок кышында, күн кыска болгондо, кыйла натыйжалуу болот.",
          about_project_part7:
            "Жогору жакка болжол менен 30 килограмм жүк көтөрүп чыгууга туура келди. Бул ишти Василий экөөбүз бирге аткардык. Кокусунан керектүү убакта керектүү жерде кримпер менен жолугуп калган Дима Доброхотов монтаждоо иштерине жардам берди.",
          about_project_part8:
            "Келечек пландарыбыз кандай? Азыркы учурда биздин ретранслятор толугу менен күн энергиясында иштейт. Башкача айтканда, түнкүсүн интернет жок болот. Биз азыр экинчи панелди, аккумулятор блогу жана кубаттоо көзөмөлдөгүчүн орнотууну пландаштыруудабыз. Аларды орнотсок, бизде интернет күнү-түнү болот. Бул идея үчүн керек жабдуулардын болжолдуу баасы 40 миң сомдой болот.",
          used_equipment_title: "Колдонулган жабдуулар",
          used_equipment_intro: "Долбоор үчүн төмөнкү жабдуулар сатып алынган:",
          used_equipment_item1: "Mikrotik LHG6 кит — кабыл алуучу табак",
          used_equipment_item2: "Mikrotik SXTsq Lite5 2 даана — радиокөпүрө",
          used_equipment_item3: "Күн панели SM 100-12 P (100Вт, поликристалл)",
          used_equipment_item4:
            "Заряд көзөмөлдөгүчү Victron BlueSolar MPPT 75/15",
          used_equipment_item5: "Гелий аккумулятору DTM 1240 L",
          used_equipment_item6:
            "Arduino nano, DC-DC модулу, жогорку сыйымдуулуктагы конденсаторлор, радио компоненттери — телефон бурасындагы кубат көзөмөлдөгүчү",
          used_equipment_item7:
            "Raspberry Pi 4 — хижинадагы жергиликтүү сервистер, трафикти көзөмөлдөө",
          used_equipment_item8:
            "Кайсы бир USB Wi-Fi тармак картасы тышкы антеннасы менен — интернетти мүмкүн болушунча кеңири таратуу",
          used_equipment_item9:
            "256GB SSD диски — MicroSD менен салыштырганда ишенимдүү жана ылдам сактоо ыкмасы, ошондой эле RPI үчүн негизги диск болуп кызмат кылат",
          used_equipment_item10:
            "BMP280 — температура, басым жана нымдуулук сенсору",
          used_equipment_item11:
            "Көптөгөн брус, зымдар, гофр, монтаждоо бурчтары",
          used_equipment_additional:
            "Мындан тышкары, талаа эксперименттери жана изилдөөлөр үчүн сектордук MIMO антенна, LTE-модем, бир жуп DC-DC модулу жана Wi-Fi кирүү чекити сатып алынды.",
          software_used_title: "Колдонулган программалык камсыздоо",
          software_used_intro:
            "Бардык баштапкы коддорду биздин долбоорлор топтомунда табууга болот <a href='https://github.com/ala-archa'>Github'да</a>. Эгерде кененирээк айтсак:",
          software_used_item1:
            "Raspbian OS — Raspberry PIде колдонулган операциялык система",
          software_used_item2:
            "ipset, iptables, dhcpd, hostapd, bind — интернетти таратуу, тармактык трафикти башкаруу",
          software_used_item3:
            "Captive порталды башкаруу үчүн жазылган backend жана frontend",
          software_used_item4: "Lemmy — блог",
          software_used_item5:
            "MiniDLNA — DLNA колдогон плеерлер үчүн медиа-файлдарды таратуу",
          software_used_item6:
            "Аба ырайынын божомолу, гидбуктарды айландыруу үчүн колдонулган тутумдар. httrack жана yt-dl негизделген",
          software_used_item7:
            "Ansible — Raspberry PIде кызматтарды жайылтуу тутуму",
          software_used_item8:
            "Grafana — аба ырайынын маалыматтары боюнча кооз графиктерди көрсөтүү, ошондой эле системалардын ички абалын көзөмөлдөө",
          software_used_item9:
            "bsbmp-exporter — метеостанциянын сенсорунан тутумга маалымат берүү",
          software_used_item10:
            "mikrotik-exporter — антенналардан тутумга маалымат берүү",
          software_used_item11:
            "openvpn — чоң жерден бүткүл системаны башкаруу мүмкүнчүлүгү",
          section_title_thank_you: "Ыраазычылык билдирүү",
          section_thank_you_text:
            "Чыгымдарды жарым-жартылай жабууга жардам бергениңизге ыраазы болобуз. Донорлук кылуунун жолдору <a href='/donate.html' class='otherlink' data-i18n='donate_link'>бул жерде</a> сүрөттөлгөн. Бул жерде интернеттин пайда болуу мүмкүнчүлүгүнө болжол менен 350 адам-саат жумуш жана 2022-2023-жылдардагы баалар менен 60,000 сом салынган. Биз айына мобилдик операторго 1,000 сомдон ашык төлөйбүз.",
          section_thank_you_button: "Ыраазычылык билдирүү — басыңыз!",

          about_project_task1:
            "Радиокөпүрөнү уюштуруу. Биздин эч кимибиз тармак инженери эмеспиз, андыктан нөлдөн түшүнүүгө туура келди.",
          about_project_task2:
            "Радиокөпүрөгө кубат берүү. Василий электроника инженери болгондуктан, көйгөйдү чечүүгө активдүү катышты.",
          about_project_task3:
            "Канал дагы эле алсыз жана каалаган колдонуучу аны ар кандай торенттер менен бөгөп коёт. Мен бул кызматты бардык адамдарга адилет бөлүштүрүүчү жана жергиликтүү кызматтарды (видео, гидбуктар, китептер, форум ж.б.) камсыз кылуу максатын койгом.",
          about_project_task4:
            "Жергиликтүү кызматтар жана интернетке ыңгайлуу жеткиликтүүлүктү уюштуруу үчүн кооз жергиликтүү сайт керек болчу. Аны Святослав ишке ашырды.",
        },
      },
    },
  },
  function (err, t) {
    if (err) return console.log("Something went wrong in loading i18n", err);
    updateContent(), updateButtons();
  }
);
