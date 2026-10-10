// shoe-picker.js — "which shoes are you in?", asked once at the start of a run or
// strength session, and offered again from the summary to correct a wrong tap.
//
// One tap. The pair you wore last is preselected and listed first, each pair
// shows how far it has gone, and a worn-out pair says so here, where the choice
// is being made. "Not in running shoes" is a real answer (barefoot lifting, a
// gym that wants other shoes), so the session counts toward no pair.

import { el, clear, backBtn } from "../ui.js";
import { getShoes, saveShoe, getAllSessions } from "../store.js";
import { activeShoes, shoeTotals, shoeStatus, defaultShoeId, makeShoe } from "../shoes.js";
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
 * for "not in running shoes".
 *
 * ⚠ IT ALWAYS ASKS once shoes are tracked, even with no pair yet. It used to
 * skip itself silently when there was nothing to choose from, and with the
 * feature switched on but the first pair not yet added, that read as the
 * feature not working. With no pair, the prompt is where you add one: the
 * moment you are standing in it is the moment you know which it is. A new pair
 * can be added from here at any time, too.
 */
export async function shoePrompt(stage) {
  const { rows, preferred } = await shoeChoices();
  return new Promise((res) => {
    const name = el("input", { type: "text", placeholder: "e.g. Brooks Ghost 18", "aria-label": "Name of the pair you're wearing",
      style: "flex:1;min-width:0;padding:10px 12px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)" });
    const note = el("p.note", { style: "margin-top:8px;min-height:1em" });
    const addAndUse = async () => {
      const n = name.value.trim();
      if (!n) { note.textContent = "Type the pair's name first."; name.focus(); return; }
      const shoe = await saveShoe(makeShoe(n));
      res(shoe.id);
    };
    const addRow = el("div", { style: "margin-top:14px" + (rows.length ? ";display:none" : "") }, [
      el("div.row", { style: "gap:8px;align-items:center" }, [
        name, el("button.btn.primary", { onclick: addAndUse }, "Add and use"),
      ]),
      note,
    ]);
    const showAdd = el("button.btn.ghost.block", { style: "margin-top:10px" + (rows.length ? "" : ";display:none"),
      onclick: () => { addRow.style.display = ""; showAdd.style.display = "none"; name.focus(); } }, "+ A new pair");
    clear(stage);
    stage.appendChild(el("div", {}, [
      backBtn("Today", "#/"),
      el("div.label", { style: "margin-top:8px", text: "Shoes" }),
      el("h1", { style: "margin:4px 0 0", text: "Which shoes are you in?" }),
      el("p.dim", { text: rows.length
        ? "A run adds the distance you log. A strength session adds 0.5 km."
        : "No pair yet. Add the one you're wearing: it starts at 0 km, and from now on each run adds its distance and each strength session 0.5 km." }),
      rows.length ? el("div.list", { style: "margin-top:16px" }, rows.map((r) => choiceButton(r, r.shoe.id === preferred, res))) : null,
      addRow,
      showAdd,
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
