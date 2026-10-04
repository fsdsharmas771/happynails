// No React here: vite.config.ts imports this to inline the script into index.html.

/** localStorage key for the visitor's explicit theme choice ("light" | "dark"). */
export const THEME_STORAGE_KEY = "hn-theme";

/**
 * Runs in <head> so a saved choice applies before first paint (no flash of the wrong theme).
 * Without a saved choice nothing is set and the CSS follows prefers-color-scheme.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

/**
 * Vite plugin for both apps. In development the script is inlined; production builds load it as
 * a small blocking file instead, so the Content-Security-Policy needs no inline-script exception.
 */
export function themeBootPlugin() {
  let build = false;
  return {
    name: "happynails-theme-boot",
    configResolved(config: { command: string }) {
      build = config.command === "build";
    },
    generateBundle(this: { emitFile(file: { type: "asset"; fileName: string; source: string }): string }) {
      if (build) this.emitFile({ type: "asset", fileName: "theme-boot.js", source: THEME_BOOT_SCRIPT });
    },
    transformIndexHtml: () => [
      build
        ? { tag: "script", attrs: { src: "/theme-boot.js" }, injectTo: "head-prepend" as const }
        : { tag: "script", children: THEME_BOOT_SCRIPT, injectTo: "head-prepend" as const },
    ],
  };
}
