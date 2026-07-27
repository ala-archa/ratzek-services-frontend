const API_client = "/api/v1/client";
const btn = document.getElementById("ap-control");
const header = document.getElementById("header");

let currentStateIntervalTicker = null;

window.addEventListener("scroll", () => {
  if (window.scrollY > 10) {
    header.classList.add("header_scrolled");
  } else {
    header.classList.remove("header_scrolled");
  }
});

document
  .querySelectorAll(".section_attention__button, .section_about__button")
  .forEach((button) => {
    button.addEventListener("touchstart", () => button.classList.add("active"));
    button.addEventListener("touchend", () =>
      button.classList.remove("active")
    );
  });

function startNewStateTicker(interval, fn) {
  if (currentStateIntervalTicker) {
    clearInterval(currentStateIntervalTicker);
  }
  fn();
  currentStateIntervalTicker = setInterval(fn, interval);
}

function mainButtonTicker() {
  fetch(API_client)
    .then((resp) => resp.json())
    .then((resp) => {
      console.log("🚀 ~ .then ~ resp:", resp);

      // Интернета нет, всё тлен. Сообщаем об этом пользователю и больше ничего не делаем.
      if (!resp.is_internet_available) {
        btn.classList = "buttonNoAccess";
        btn.innerText = i18next.t("no_internet");

        return;
      }

      // Пользователь не включил себе интернет. Показываем кнопку со счетчиком.
      if (resp.internet_connection_status == "Inactive") {
        // Если нам передали какой-то идентификатор интервала - отменяем его перед вызовом тикера кнопки
        waitforEnterance();

        return;
      }

      // Пользователь в черном списке. Запрещаем любые действия.
      if (resp.internet_connection_status == "ClientBlacklisted") {
        btn.classList = "buttonNoAccess";
        btn.innerText = i18next.t("client_blacklisted");

        return;
      }

      // Если не Inactive, то ожидалось Connected. Но не получили его. Ругаемся в консоль, ничего не делаем.
      if (!resp.internet_connection_status.Connected) {
        btn.classList = "buttonNoAccess";
        console.log(i18next.t("unexpected_status"));

        return;
      }

      // У нас статус Connected, показываем статистику
      const mb_spent = Math.floor(
        resp.internet_connection_status.Connected.bytes_sent / 1024 / 1024
      );
      const mb_limit = Math.floor(
        resp.internet_connection_status.Connected.bytes_unlimited_limit /
          1024 /
          1024
      );

      var date = new Date(0);
      date.setSeconds(
        resp.internet_connection_status.Connected.shaper_reset_secs
      );
      const drop_duration = date.toISOString().substring(11, 19);

      btn.classList = "buttonAccessGranted";
      btn.innerHTML =
        `<span class="btn_status">${i18next.t("access_active")}</span>` +
        `<span class="btn_details">${i18next.t("data_usage", {
          mb_spent,
          mb_limit,
          drop_duration,
        })}</span>`;
    })
    .catch((error) => {
      console.error(error);
      btn.classList = "buttonNoAccess";
    });
}

function waitforEnterance() {
  let sec = 10;
  startNewStateTicker(1000, () => {
    btn.innerText = i18next.t("wait_for_entrance", { sec });
    if (sec <= 0) {
      btn.innerText = i18next.t("access_granted");
      btn.classList = "buttonRequestAccess";
      btn.removeAttribute("disabled");
      clearInterval(currentStateIntervalTicker);
    }
    sec -= 1;
  });
}

function requestAccess() {
  fetch(API_client, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: "",
  })
    .then(() => {
      console.log("Logged in");
      startNewStateTicker(5000, mainButtonTicker);
    })
    .catch((error) => {
      console.error(error);
    });
}

btn.addEventListener("click", requestAccess);

startNewStateTicker(5000, mainButtonTicker);
