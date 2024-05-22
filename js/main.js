const API_client = '/api/v1/client';
const btn = document.getElementById('ap-control');
const header = document.getElementById('header');
let currentStateIntervalTicker = null;

window.addEventListener('scroll', () => {
  if (window.scrollY > 10) {
    header.classList.add('header_scrolled');
  } else {
    header.classList.remove('header_scrolled');
  }
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
      console.log(resp);

      // Интернета нет, всё тлен. Сообщаем об этом пользователю и больше ничего не делаем.
      if (!resp.is_internet_available) {
        btn.classList = 'buttonNoAccess';
        btn.innerText = `К сожалению, интернета в данный момент нет`;

        return;
      }

      // Пользователь не включил себе интернет. Показываем кнопку со счетчиком.
      if (resp.internet_connection_status == 'Inactive') {
        // Если нам передали какой-то идентификатор интервала - отменяем его перед вызовом тикера кнопки
        waitforEnterance();

        return;
      }

      // Пользователь в черном списке. Запрещаем любые действия.
      if (resp.internet_connection_status == 'ClientBlacklisted') {
        btn.classList = 'buttonNoAccess';
        btn.innerText = `К сожалению, для вас ограничена возможность выхода в интернет`;

        return;
      }

      // Если не Inactive, то ожидалось Connected. Но не получили его. Ругаемся в консоль, ничего не делаем.
      if (!resp.internet_connection_status.Connected) {
        btn.classList = 'buttonNoAccess';
        console.log('Что-то пошло не так, нет ожидаемого статуса');

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

      btn.classList = 'buttonAccessGranted';
      btn.innerText =
        `Вы израсходовали ${mb_spent} MB из ${mb_limit} на безлимитной скорости. ` +
        `До сброса счетчика осталось ${drop_duration}`;
    })
    .catch((error) => {
      console.error(error);
      btn.classList = 'buttonNoAccess';
    });
}

function waitforEnterance() {
  let sec = 10;
  startNewStateTicker(1000, () => {
    btn.innerText = `до входа осталось ${sec} сек`;
    if (sec <= 0) {
      btn.innerText = 'МОЖНО ВОЙТИ, ЖМИ';
      btn.classList = 'buttonRequestAccess';
      btn.removeAttribute('disabled');
      clearInterval(currentStateIntervalTicker);
    }
    sec -= 1;
  });
}

function requestAccess() {
  fetch(API_client, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: '',
  })
    .then(() => {
      console.log('Logged in');
      startNewStateTicker(5000, mainButtonTicker);
    })
    .catch((error) => {
      console.error(error);
    });
}

btn.addEventListener('click', requestAccess);

startNewStateTicker(5000, mainButtonTicker);
