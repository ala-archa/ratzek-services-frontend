const btn = document.querySelector('button');
const testBnt = document.querySelector('#testBtn');
let sec = 10;
btn.addEventListener('click', entrance);
const API_client = '/api/v1/client';

autoPing();

function autoPing() {
  ping(null);
  const int = setInterval(() => {
    ping(int);
  }, 5 * 1000);
}

function ping(autoping_interval) {
  fetch(API_client)
    .then((resp) => resp.json())
    .then((resp) => {
      console.log(resp);

      // Интернета нет, всё тлен. Сообщаем об этом пользователю и больше ничего не делаем.
      if (!resp.is_internet_available) {
        btn.style.display = 'block';
        btn.innerText = `К сожалению доступа в данный момент нет`;

        return;
      }

      // Пользователь не включил себе интернет. Показываем кнопку со счетчиком.
      if (resp.internet_connection_status == "Inactive") {
        btn.style.display = 'block';

        // Если нам передали какой-то идентификатор интервала - отменяем его перед вызовом тикера кнопки
        if (autoping_interval != null) {
          clearInterval(autoping_interval);
        }
        tickButton();

        return;
      }

      // Если не Inactive, то ожидалось Connected. Но не получили его. Ругаемся в консоль, ничего не делаем.
      if (!resp.internet_connection_status.Connected) {
        console.log("Что-то пошло не так, нет ожидаемого статуса");

        return;
      }

      // У нас статус Connected, показываем статистику
      const mb_spent = Math.floor(resp.internet_connection_status.Connected.bytes_sent / 1024 / 1024);
      const mb_limit = Math.floor(resp.internet_connection_status.Connected.bytes_unlimited_limit / 1024 / 1024);

      var date = new Date(0);
      date.setSeconds(resp.internet_connection_status.Connected.shaper_reset_secs);
      const drop_duration = date.toISOString().substring(11, 19);

      btn.style.display = 'block';
      btn.innerText = `Вы израсходовали ${mb_spent} MB из ${mb_limit} на безлимитной скорости. `
        + `До сброса счетчика осталось ${drop_duration}`;
      btn.style.backgroundColor = 'rgb(106, 194, 72)';
    })
    .catch((error) => {
      console.error(error);
    });
}

function tickButton() {
  const int = setInterval(() => {
    sec -= 1;
    btn.innerText = `до входа осталось ${sec}`;
    if (sec === 0) {
      btn.innerText = 'МОЖНО ВОЙТИ';
      btn.style.backgroundColor = 'rgb(106, 194, 72)';
      btn.removeAttribute('disabled');
      clearInterval(int);
    }
  }, 1000);
}

function entrance() {
  fetch(API_client, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: '',
  })
    .then(() => {
      console.log('Logged in');
      ping();
      autoPing();
    })
    .catch((error) => {
      console.error(error);
    });
}
