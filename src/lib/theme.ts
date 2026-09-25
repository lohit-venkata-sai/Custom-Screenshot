export function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  try {
    localStorage.setItem("cs-theme", theme);
  } catch {
    /* noop */
  }
}

export function initialTheme(): "light" | "dark" {
  try {
    const t = localStorage.getItem("cs-theme");
    if (t === "dark" || t === "light") return t;
  } catch {
    /* noop */
  }
  return "light";
}
