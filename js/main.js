const btn = document.querySelector("button");
const testBnt = document.querySelector("#testBtn");
btn.addEventListener("click", clickTest);

let sec = 10;
const interval = setInterval(() => {
  sec -= 1;
  btn.innerText = `до входа осталось ${sec}`;
  if (sec === 0) {
    btn.innerText = "МОЖНО ВОЙТИ";
    btn.style.backgroundColor = "rgb(106, 194, 72)";
    btn.removeAttribute("disabled");
    clearInterval(interval);
  }
}, 1000);

const test = { test: "test" };

function clickTest() {
  fetch("/api/v1/client", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: '',
  });
}
