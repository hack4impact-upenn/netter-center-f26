import { useState } from "react";

export type Theme = "light" | "dark";

/** Reads and flips the theme index.html set before first paint. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark"
  );

  function setTheme(next: Theme) {
    // Swap every colour at once rather than letting each control fade on its own.
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.dataset.theme = next;
    window.getComputedStyle(document.body).opacity;
    window.setTimeout(() => root.classList.remove("theme-switching"), 1);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private windows can refuse storage; the theme still applies for this visit.
    }
    setThemeState(next);
  }

  return { theme, setTheme };
}
