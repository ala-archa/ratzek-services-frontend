const btn = document.querySelector('button');
const testBnt = document.querySelector('#testBtn');
let sec = 10;
btn.addEventListener('click', entrance);
const API_client = '/api/v1/client';

ping(interval);

function ping(interval) {
  fetch(API_client)
    .then((resp) => resp.json())
    .then((resp) => {
      console.log(resp);
      if (resp.is_internet_available) {
        btn.style.display = 'block';
        interval();
      } else if (
        resp.is_internet_available ||
        resp.internet_connection_status.Connected.bytes_sent > 0
      ) {
        btn.style.display = 'block';
        btn.innerText = `Вы израсходовали ${resp.internet_connection_status.Connected.bytes_sent} из ${resp.internet_connection_status.Connected.bytes_unlimited_limit} на безлимитной скорости.`;
        btn.style.backgroundColor = 'rgb(106, 194, 72)';
      } else if (!resp.is_internet_available) {
        btn.style.display = 'block';
        btn.innerText = `К сожалению доступа в данный момент нет`;
      }
    })
    .catch((error) => {
      console.error(error);
    });
}

function interval() {
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
    .then(() => console.log('ыы'))
    .catch((error) => {
      console.error(error);
    });
}
