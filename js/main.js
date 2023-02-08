const btn = document.querySelector("button");
const testBnt = document.querySelector("#testBtn");

let sec = 10;
const interval = setInterval(() => {
  sec = sec - 1;
  console.log(sec);
  btn.innerText = `до входа осталось ${sec}`;
  if (sec === 1) {
    btn.innerText = "иди в очко";
    btn.style.backgroundColor = "green";
    btn.removeAttribute("disabled");
    clearInterval(interval);
  }
}, 1000);

function clickTest() {
  testBnt.innerText = "кнопка активна";
}

btn.addEventListener("click", clickTest);
