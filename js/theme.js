const themeSwitch = document.querySelector(".header_theme-switcher");
const body = document.body;

document.addEventListener("DOMContentLoaded", function () {
  const currentTheme = localStorage.getItem("theme");
  if (currentTheme === "theme-dark") {
    body.classList.add("theme-dark");
  }
});

themeSwitch.addEventListener("click", function () {
  if (body.classList.contains("theme-dark")) {
    localStorage.setItem("theme", "");
    body.classList.remove("theme-dark");
  } else {
    body.classList.add("theme-dark");
    localStorage.setItem("theme", "theme-dark");
  }
});
