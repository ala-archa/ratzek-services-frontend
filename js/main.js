const btn = document.querySelector('button');
const testBnt = document.querySelector('#testBtn');
let sec = 10;
btn.addEventListener('click', entrance);
// const API = '/api/v1/client';
const API = 'http://82.146.59.228:5001/api/v1/client';

ping(interval);

function ping(interval) {
   fetch(API)
      .then((resp) => resp.json())
      .then((resp) => {
         if (resp.internet_connection_status === 'Inactive') {
            btn.style.display = 'block';
            interval();
         } else if (resp.internet_connection_status === 'Connected') {
            btn.innerText = ``;
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
   fetch(API, {
      method: 'POST',
      headers: {
         'content-type': 'application/json; charset=utf-8',
      },
      body: '',
   }).catch((error) => {
      console.error(error);
   });
}
