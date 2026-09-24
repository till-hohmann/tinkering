// interrupt.js — the "you're leaving a workout" bottom sheet. Offers the three
// choices offered whenever a session is interrupted (the X button, or on
// re-opening a session that was closed mid-workout):
//   • continue later — keep the progress saved, pick it up next time
//   • complete       — stop adding exercises, but log what's been done so far
//   • discard        — throw the session away without logging anything
// Resolves to "continue" (dismissed / keep training), "later", "complete" or
// "discard". `canComplete` hides the complete option when nothing is logged yet.

import { el } from "../ui.js";

export function interruptSheet({
  title = "Leave this workout?",
  subtitle = "Your logged sets are saved. What would you like to do?",
  canComplete = true,
  resumeLabel = "Keep training",
} = {}) {
  return new Promise((res) => {
    const ov = el("div.sheet");
    const btn = (cls, label, sub, val) =>
      el("button.item" + cls, { style: "text-align:left", onclick: () => close(val) }, [
        el("div.meta", {}, [el("div.t", { text: label }), sub ? el("div.s", { text: sub }) : null]),
      ]);
    const actions = [
      btn(".isave", "Save & continue later", "Keep everything; finish this session another time", "later"),
      canComplete ? btn(".idone", "Complete now", "Stop here and log what you've done", "complete") : null,
      btn(".idiscard", "Discard workout", "Throw it away — nothing gets logged", "discard"),
    ].filter(Boolean);

    ov.appendChild(el("div.sheet-card", {}, [
      el("div.sheet-grip"),
      el("div", { style: "margin-bottom:6px" }, [
        el("h2", { style: "margin:0", text: title }),
        el("p.dim", { style: "margin:6px 0 0", text: subtitle }),
      ]),
      el("div.list", { style: "margin-top:12px" }, actions),
      el("button.btn.ghost.block", { style: "margin-top:10px", onclick: () => close("continue") }, resumeLabel),
    ]));
    ov.addEventListener("click", (e) => { if (e.target === ov) close("continue"); }); // tap backdrop = keep training
    function close(val) { ov.remove(); res(val); }
    document.body.appendChild(ov);
  });
}
