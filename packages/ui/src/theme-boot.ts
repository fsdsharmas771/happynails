// No React here: vite.config.ts imports this to inline the script into index.html.

/** localStorage key for the visitor's explicit theme choice ("light" | "dark"). */
export const THEME_STORAGE_KEY = "hn-theme";

/**
 * Runs in <head> so a saved choice applies before first paint (no flash of the wrong theme).
 * Without a saved choice nothing is set and the CSS follows prefers-color-scheme.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
