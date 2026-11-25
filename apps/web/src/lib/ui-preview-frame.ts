// What every Saasaloy UI preview frame sets before its first paint (plan 0121): the light
// or dark mode and the theme variables. Two pages use it, /ui/preview/<name> (one block)
// and /ui/preview/page (a composed page for the builder and the template cards).
//
// The mode: `?mode=light|dark` wins. Otherwise the frame follows the page that embeds it:
// that page's `data-ui-preview-mode` (the block page's preview-only toggle) when set, else
// its own `dark` class, and it changes with either. A frame that stands alone follows the
// system setting. A theme toggle inside the frame flips the frame only, never the site's
// stored choice (assumption 36).

import { themeRules, UI_THEMES } from "@web/lib/ui-themes";

export const MODE_SCRIPT = `(function(){var d=document.documentElement;function a(k){d.classList.toggle("dark",k);d.style.colorScheme=k?"dark":"light";d.setAttribute("data-theme",k?"dark":"light")}var m=new URLSearchParams(location.search).get("mode");var p=null;try{p=window.parent!==window?window.parent.document.documentElement:null}catch(e){}function f(){var o=p.getAttribute("data-ui-preview-mode");a(o==="dark"||o==="light"?o==="dark":p.classList.contains("dark"))}if(m==="dark"||m==="light"){a(m==="dark")}else if(p){f();new MutationObserver(f).observe(p,{attributes:true,attributeFilter:["class","data-ui-preview-mode"]})}else{a(matchMedia("(prefers-color-scheme: dark)").matches)}document.addEventListener("click",function(e){var t=e.target instanceof Element?e.target.closest("[data-theme-toggle]"):null;if(t){a(!d.classList.contains("dark"))}})})();`;

/** The variables of every theme, on `<html data-ui-theme="<name>">`. */
export const THEME_CSS = UI_THEMES.map((theme) =>
  themeRules(theme, {
    light: `html[data-ui-theme="${theme.name}"]`,
    dark: `html.dark[data-ui-theme="${theme.name}"]`,
  })
).join("\n");
