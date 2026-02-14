const storageKey = "theme";
const className = "dark";
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const currentTheme = localStorage.getItem(storageKey);

if (currentTheme === className || (!currentTheme && prefersDark)) {
  document.documentElement.classList.add(className);
}
