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
    updateButtons();
  });
}

const savedLanguage = localStorage.getItem("language") || "ru";

i18next.init(
  {
    lng: savedLanguage,
    resources: {
      en: {
        translation: {
          header_title: "[Internet at Ratsek Hut]",
          main_address:
            "You can always return to this page by entering the address",
          main_link: "http://www.ratzek 🚀",
          section_title_always_available:
            "Always available, even without internet",
          section_title_services: "Useful services on the internet",
          section_title_thank_you: "Thank you",
          section_thank_you_text:
            "We would appreciate partial reimbursement of expenses. Described ways to transfer donations here. About 350 man-hours of work and about 60,000 soms in 2022-2023 prices were invested in the possibility of internet appearing here. Monthly, we pay more than 1,000 soms to the mobile operator.",
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
            "And so that they have time to familiarize themselves with this page, we have added an entry delay",
          weather_forecast: "Weather forecast from Mountain Forecast",
          video_guide: "Video guide by Dmitry Pavlenko",
          community_guide: "Community-created guidebook",
          webcam_archive: "<b>NEW!</b> Webcam archive (2 weeks)",
          telegram_chat: "<b>NEW!</b> Telegram chat",
          webcam: "<b>NEW!</b> Webcam",
          sign_in_button: "Sign in",
          participant_1:
            "Vasily Tsarevsky — designer of power supply controllers, also carried non-standard cargo to the hut.",
          participant_2:
            "Dmitry Dobrokhotov — installation of network equipment on site.",
          participant_3:
            "Dmitry Pavlenko — creator of the stand for the solar panel, helped with purchases and delivery of non-standard cargo.",
          participant_4:
            "Evgeny Lepikhin — author of the idea, research on site, programming and configuration, installation.",
          participant_5: "Maxim Mesh — helped with wiring.",
          participant_6:
            "Svyatoslav Deev — creator of the site you are currently on.",
          no_internet: "Unfortunately, there is no internet at the moment",
          inactive_status: "Please wait for access",
          client_blacklisted:
            "Unfortunately, internet access is restricted for you",
          unexpected_status: "Something went wrong, unexpected status",
          data_usage:
            "You have used {{mb_spent}} MB out of {{mb_limit}} MB at unlimited speed. Reset in {{drop_duration}}",
          wait_for_entrance: "Time left for entrance: {{sec}} seconds",
          access_granted: "YOU CAN ENTER, CLICK",
          request_access: "Requesting access...",
        },
      },
      ru: {
        translation: {
          header_title: "[Интернет на хижине Рацека]",
          main_address:
            "Вы всегда можете вернуться на эту страницу введя адрес",
          main_link: "http://www.ratzek 🚀",
          section_title_always_available: "Всегда доступно, даже без интернета",
          section_title_services: "Полезные сервисы в интернете",
          section_title_thank_you: "Поблагодарить",
          section_thank_you_text:
            "Будем благодарны за частичную компенсацию расходов. Здесь описаны способы перевода донатов. В возможность появления здесь интернета было вложено порядка 350 человеко-часов работы и около 60.000 сом в ценах 2022-2023 годов. Ежемесячно сотовому оператору мы оплачиваем более 1000 сом.",
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
            "А чтобы с этой страницей успели ознакомиться, мы добавили задержку входа.",
          weather_forecast: "Прогноз погоды от Mountain Forecast",
          video_guide: "Видео-гайд от Дмитрия Павленко",
          community_guide: "Созданный сообществом гайдбук",
          webcam_archive: "<b>NEW!</b> Архив веб-камеры (2 недели)",
          telegram_chat: "<b>NEW!</b> Чат в Telegram",
          webcam: "<b>NEW!</b> Веб-камера",
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
          unexpected_status: "Что-то пошло не так, неожиданный статус",
          data_usage:
            "Вы израсходовали {{mb_spent}} MB из {{mb_limit}} MB на безлимитной скорости. До сброса счетчика осталось {{drop_duration}}",
          wait_for_entrance: "Осталось до входа: {{sec}} секунд",
          access_granted: "МОЖНО ВОЙТИ, ЖМИ",
          request_access: "Запрашиваем доступ...",
        },
      },
      kg: {
        translation: {
          header_title: "[Рацека Хижинасындагы Интернет]",
          main_address: "Сиз бул бетке ар дайым кайтып келсеңиз болот",
          main_link: "http://www.ratzek 🚀",
          section_title_always_available:
            "Интернетсиз дагы ар дайым жеткиликтүү",
          section_title_services: "Интернеттеги пайдалуу кызматтар",
          section_title_thank_you: "Ыраазычылык билдирүү",
          section_thank_you_text:
            "Интернет акысыз берилет. Аны баарына жеткиликтүү кылуу үчүн, ашыкча колдонгон колдонуучуларга ылдамдыкты чектейбиз. Башкача айтканда, эгер сиз интернетти белгилүү бир убакытка чейин өтө активдүү колдонуп жатсаңыз (видео көрүү, видео-звонок ж.б.), сиздин интернет ылдамдыгыңыз бир нече саатка жайлайт, башкалар да кызматтан пайдалана алышы үчүн.",
          section_thank_you_button: "Ыраазычылык билдирүү — басыңыз!",
          section_title_login: "Кирүү жана статистика",
          section_login_text:
            "Интернет акысыз берилет. Бардыгына жеткиликтүү болушу үчүн, активдүү колдонуучуларга ылдамдыкты чектейбиз. Башкача айтканда, эгер сиз интернетти өтө активдүү колдонсоңуз (видео көрүү, видео чалуулар ж.б.), интернет бир нече саатка жай болот, ошондо башкалар дагы пайдалана алышат. Бул бет менен таанышууга убакыт бериши үчүн, кирүү кечиктирүүнү коштук.",
          section_title_about: "Долбоор жөнүндө",
          section_about_text: "Долбоорго катышкандар:",
          section_about_button: "Кантип жаралганын кененирээк",
          data_meteostation: "Метеостанциянын маалыматы",
          library: "Китептер жана фильмдер китепканасы",
          login_delay_text:
            "Жана алардын бул баракча менен таанышууга убактысы болушу үчүн, биз кирүү кечигүүсүн коштук.",
          weather_forecast: "Mountain Forecast боюнча аба ырайынын божомолу",
          video_guide: "Дмитрий Павленконун видео гид",
          community_guide: "Жамаат тарабынан түзүлгөн гидбук",
          webcam_archive: "<b>NEW!</b> Веб-камера архиви (2 жума)",
          telegram_chat: "<b>NEW!</b> Telegram чат",
          webcam: "<b>NEW!</b> Веб-камера",
          sign_in_button: "Кирүү",
          participant_1:
            "Василий Царевский — электр жабдууларын долбоорлоочу, ошондой эле хижинага стандартка жатпаган жүктү алып келген.",
          participant_2:
            "Дмитрий Доброхотов — жеринде тармактык жабдууларды орнотуу.",
          participant_3:
            "Дмитрий Павленко — күн панели үчүн стойка түзүүчү, сатып алуу жана стандартка жатпаган жүктү жеткирүү боюнча жардам берген.",
          participant_4:
            "Евгений Лепихин — идеянын автору, жеринде изилдөө, программалоо жана орнотуу, монтаждоо.",
          participant_5: "Максим Меш — зымдарды туташтырууга жардам берген.",
          participant_6:
            "Святослав Деев — сиз азыр жүргөн сайттын жаратуучусу.",
          no_internet: "Тилекке каршы, учурда интернет жок",
          inactive_status: "Кирүү үчүн күтө туруңуз",
          client_blacklisted:
            "Тилекке каршы, сиз үчүн интернетке кирүү чектелген",
          unexpected_status:
            "Бир нерсе туура эмес болуп калды, күтүлбөгөн статус",
          data_usage:
            "Сиз чексиз ылдамдыкта {{mb_spent}} MB колдондуңуз {{mb_limit}} MBдан. Төртүнчү эсептегичте калды {{drop_duration}}",
          wait_for_entrance: "Кирүү үчүн калган убакыт: {{sec}} секунд",
          access_granted: "КИРСЕҢИЗ БОЛОТ, БАСЫҢЫЗ",
          request_access: "Кирүү суралууда...",
        },
      },
    },
  },
  function (err, t) {
    if (err) return console.log("Something went wrong in loading i18n", err);
    updateContent(), updateButtons();
  }
);
