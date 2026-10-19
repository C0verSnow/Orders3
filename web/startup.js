import { $ } from "./ui.js";

export function initStartup(fastStartup) {
  // The native splash and this overlay share a centered, stationary logo.
  // Move that same silhouette into the header, with a brief squash before release.
  let startupStarted = false;
  let startupInteracted = false;
  for (const event of ["pointerdown", "keydown"]) {
    document.addEventListener(event, () => { startupInteracted = true; }, {once: true, capture: true});
  }
  window.beginStartupTransition = async () => {
    if (startupStarted) return;
    startupStarted = true;
    const overlay = $("startup");
    if (!overlay) return;
    if (!startupInteracted) {
      document.body.tabIndex = -1;
      document.body.focus({preventScroll: true});
    }
    if (!fastStartup || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      overlay.remove();
      return;
    }
    const mark = overlay.querySelector(".startup-mark");
    const source = mark.getBoundingClientRect();
    const target = document.querySelector(".brand img").getBoundingClientRect();
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const scale = target.width / source.width;
    mark.style.transformOrigin = "top left";
    document.body.classList.add("startup-running");
    const options = {duration: 720, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards"};
    const motion = mark.animate([
      {transform: "translate(0,0) scale(1,1)", offset: 0},
      {transform: "translate(-3px,4px) scale(1.07,.90)", offset: .16},
      {transform: `translate(${dx}px,${dy}px) scale(${scale})`, offset: 1},
    ], options);
    // Fade the background separately so the moving logo stays solid.
    overlay.animate([{backgroundColor: "#f6f8f5"}, {backgroundColor: "transparent"}], options);
    for (const text of overlay.querySelectorAll(".startup-wordmark,.startup-caption")) {
      text.animate([{opacity: 1, transform: "translateY(0)"},
                    {opacity: 0, transform: "translateY(-8px) scale(.96)"}],
                   {duration: 260, easing: "ease-in", fill: "forwards"});
    }
    try { await motion.finished; } finally {
      document.body.classList.remove("startup-running");
      overlay.remove();
    }
  };
  const desktopStartup = new URLSearchParams(location.search).get("desktop") === "1";
  if (!desktopStartup) {
    if (document.readyState === "complete") window.beginStartupTransition();
    else window.addEventListener("load", window.beginStartupTransition, {once: true});
  }
  // Recover if a host callback fails; never leave the homepage covered indefinitely.
  setTimeout(window.beginStartupTransition, 2500);
}
