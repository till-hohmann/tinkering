// shoe-picker.js — "which shoes are you in?", asked once at the start of a run or
// strength session, and offered again from the summary to correct a wrong tap.
//
// One tap. The pair you wore last is preselected and listed first, each pair
// shows how far it has gone, and a worn-out pair says so here, where the choice
// is being made. "Not in running shoes" is a real answer (barefoot lifting, a
// gym that wants other shoes), so the session counts toward no pair.

import { el, clear, backBtn } from "../ui.js";
import { getShoes, getAllSessions } from "../store.js";
import { activeShoes, shoeTotals, shoeStatus, defaultShoeId } from "../shoes.js";
import { distanceValue, distanceLabel } from "../units.js";

export function fmtShoeKm(km) {
  return `${Math.round(distanceValue(km || 0) || 0).toLocaleString("en-GB")} ${distanceLabel()}`;
}

const STATUS_BADGE = {
  ok: null,
  soon: { text: "Nearly worn", style: "color:var(--amber);border-color:var(--amber)" },
  replace: { text: "Replace", style: "color:var(--red);border-color:var(--red)" },
};

/** Rows for the active pairs, last-used first, with their totals and status. */
export async function shoeChoices() {
  const shoes = activeShoes(await getShoes());
  if (!shoes.length) return { rows: [], preferred: null };
  const sessions = await getAllSessions();
  const totals = shoeTotals(sessions);
  const preferred = defaultShoeId(shoes, sessions);
  // "last used" only when it was: a pair preselected because it is the only
  // one has never been worn in a logged session.
  const lastUsed = sessions.some((s) => s.shoeId === preferred) ? preferred : null;
  const rows = shoes
    .map((s) => ({ shoe: s, km: totals[s.id] || 0, status: shoeStatus(totals[s.id] || 0, s.limitKm), lastUsed: s.id === lastUsed }))
    .sort((a, b) => (b.shoe.id === preferred) - (a.shoe.id === preferred));
  return { rows, preferred };
}

function choiceButton({ shoe, km, status, lastUsed }, isPreferred, onPick) {
  const badge = STATUS_BADGE[status];
  return el("button.item", {
    style: "text-align:left" + (isPreferred ? ";border-color:var(--accent)" : ""),
    onclick: () => onPick(shoe.id),
  }, [
    el("div.meta", {}, [
      el("div.t", { text: shoe.name }),
      el("div.s", { text: `${fmtShoeKm(km)} so far${lastUsed ? " · last used" : ""}` }),
    ]),
    badge ? el("span.badge", { style: badge.style, text: badge.text }) : null,
  ]);
}

/**
 * Full-screen prompt during the session flow. Resolves to a shoe id, or null
 * for "not in running shoes". Resolves `undefined` without asking when there is
 * no active pair, so the caller can skip it entirely.
 */
export async function shoePrompt(stage) {
  const { rows, preferred } = await shoeChoices();
  if (!rows.length) return undefined;
  return new Promise((res) => {
    clear(stage);
    stage.appendChild(el("div", {}, [
      backBtn("Today", "#/"),
      el("div.label", { style: "margin-top:8px", text: "Shoes" }),
      el("h1", { style: "margin:4px 0 0", text: "Which shoes are you in?" }),
      el("p.dim", { text: "A run adds the distance you log. A strength session adds 0.5 km." }),
      el("div.list", { style: "margin-top:16px" }, rows.map((r) => choiceButton(r, r.shoe.id === preferred, res))),
      el("button.btn.block", { style: "margin-top:12px", onclick: () => res(null) }, "Not in running shoes"),
    ]));
  });
}

/** Inline chooser for the summary: a list that replaces itself once picked. */
export async function shoeSwitcher(currentId, onPick) {
  const { rows } = await shoeChoices();
  const box = el("div.list", { style: "margin-top:10px" });
  box.append(
    ...rows.map((r) => choiceButton(r, r.shoe.id === currentId, onPick)),
    el("button.btn.block", { style: "margin-top:4px", onclick: () => onPick(null) }, "Not in running shoes"),
  );
  return box;
}
