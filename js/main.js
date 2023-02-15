const btn = document.querySelector("button");
const testBnt = document.querySelector("#testBtn");
btn.addEventListener("click", clickTest);

let sec = 10;
function tickButton() {
  sec -= 1;
  btn.innerText = `Подождите ${sec} сек`;
  if (sec === 0) {
    btn.innerText = "МОЖНО ВОЙТИ";
    btn.style.backgroundColor = "rgb(106, 194, 72)";
    btn.removeAttribute("disabled");
    clearInterval(interval);
  }
}

tickButton();

const interval = setInterval(tickButton, 1000);

function clickTest() {
  fetch("/api/v1/client", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: '',
  });
}
