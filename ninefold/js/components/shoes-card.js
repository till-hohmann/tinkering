// shoes-card.js — the Profile card for running shoes: how far each pair has
// gone, how close it is to its limit, and the few edits a pair needs (rename,
// set its limit, retire it, bring it back).
//
// Pairs are retired, never deleted. A deleted pair would leave sessions naming
// an id nothing resolves, and a retired pair's history is still true.

import { el, setChildren } from "../ui.js";
import { getShoes, saveShoe, getAllSessions } from "../store.js";
import { makeShoe, shoeTotals, shoeStatus, HEADS_UP_KM, DEFAULT_LIMIT_KM } from "../shoes.js";
import { distanceValue, distanceToKm, distanceLabel } from "../units.js";
import { fmtShoeKm } from "./shoe-picker.js";

const inputStyle = "padding:8px 10px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)";
const COLOR = { ok: "var(--accent)", soon: "var(--amber)", replace: "var(--red)" };

export async function shoesCard() {
  const card = el("div.card");
  const status = el("p.note", { style: "margin-top:8px;min-height:1em" });
  let editing = null;               // id of the pair whose editor is open

  async function paint() {
    const shoes = await getShoes();
    const totals = shoeTotals(await getAllSessions());
    const active = shoes.filter((s) => !s.retired);
    const retired = shoes.filter((s) => s.retired);
    setChildren(card, ...[
      el("div.label", { text: "Running shoes" }),
      el("p.note", { style: "margin-top:4px", text: `A run adds the distance you log, a strength session 0.5 km. Amber ${HEADS_UP_KM} km before a pair's limit, red at it.` }),
      ...active.map((s) => pairRow(s, totals[s.id] || 0)),
      active.length ? null : el("p.dim", { style: "margin:12px 0 0",
        text: retired.length ? "No pair in use. Add the one you run and lift in now." : "No pair yet. Add the shoes you run and lift in." }),
      addRow(),
      retired.length ? el("div.label", { style: "margin-top:18px", text: "Retired" }) : null,
      ...retired.map((s) => pairRow(s, totals[s.id] || 0)),
      status,
    ]);
  }

  function pairRow(shoe, km) {
    const st = shoeStatus(km, shoe.limitKm);
    const pct = Math.min(100, Math.round((km / (shoe.limitKm || DEFAULT_LIMIT_KM)) * 100));
    const note = shoe.retired ? "Retired"
      : st === "replace" ? "Past its limit. Time for a new pair."
      : st === "soon" ? "Nearly worn. Start looking for the next pair."
      : `${fmtShoeKm(Math.max(0, (shoe.limitKm || DEFAULT_LIMIT_KM) - km))} to go.`;
    return el("div", { style: "margin-top:14px" + (shoe.retired ? ";opacity:.6" : "") }, [
      el("div.row", { style: "align-items:baseline;gap:8px" }, [
        el("div", { style: "flex:1;min-width:0;font-weight:600", text: shoe.name }),
        el("div.tnum", { style: "font-size:1.35rem;font-weight:800", text: fmtShoeKm(km) }),
      ]),
      el("div.progress", { style: "margin:6px 0 0" }, [
        el("div.progress-fill", { style: `width:${pct}%;background:${COLOR[st]}` }),
      ]),
      el("div.row", { style: "margin-top:6px;gap:8px;align-items:center" }, [
        el("div.note", { style: "flex:1;margin:0" + (st !== "ok" && !shoe.retired ? `;color:${COLOR[st]}` : ""),
          text: `${note}${shoe.retired ? "." : ""} Limit ${fmtShoeKm(shoe.limitKm || DEFAULT_LIMIT_KM)}.` }),
        el("button.btn.ghost", { style: "min-height:32px;padding:0 10px",
          onclick: () => { editing = editing === shoe.id ? null : shoe.id; paint(); } }, editing === shoe.id ? "Close" : "Edit"),
      ]),
      editing === shoe.id ? editor(shoe) : null,
    ]);
  }

  function editor(shoe) {
    const name = el("input", { type: "text", value: shoe.name, "aria-label": "Name of the pair", style: inputStyle + ";flex:1;min-width:0" });
    const limit = el("input", { type: "text", inputmode: "numeric", "aria-label": `Limit in ${distanceLabel()}`,
      value: String(Math.round(distanceValue(shoe.limitKm || DEFAULT_LIMIT_KM))), style: inputStyle + ";width:84px;text-align:center" });
    const save = async () => {
      const n = name.value.trim();
      const lim = distanceToKm(limit.value);
      if (!n) { status.textContent = "Give the pair a name."; return; }
      if (!(lim > 0)) { status.textContent = "The limit needs to be a number above zero."; return; }
      const limitKm = Math.round(lim);
      // A raised limit re-arms the Today warning: dismissing "past 600 km" says
      // nothing about 700.
      const warnDismissed = limitKm > (shoe.limitKm || DEFAULT_LIMIT_KM) ? false : !!shoe.warnDismissed;
      await saveShoe({ ...shoe, name: n, limitKm, warnDismissed });
      editing = null; status.textContent = ""; paint();
    };
    const toggleRetired = async () => {
      await saveShoe({ ...shoe, retired: !shoe.retired });
      editing = null; paint();
    };
    return el("div", { style: "margin-top:10px" }, [
      el("div.row", { style: "gap:8px;align-items:center" }, [
        name, limit, el("span.dim", { text: distanceLabel() }),
      ]),
      el("div.btn-row", { style: "margin-top:8px" }, [
        el("button.btn.primary", { onclick: save }, "Save"),
        el("button.btn", { onclick: toggleRetired }, shoe.retired ? "Back in rotation" : "Retire"),
      ]),
    ]);
  }

  function addRow() {
    const name = el("input", { type: "text", placeholder: "e.g. Brooks Ghost 18", "aria-label": "Name of a new pair", style: inputStyle + ";flex:1;min-width:0" });
    const add = async () => {
      const n = name.value.trim();
      if (!n) { status.textContent = "Type the pair's name first."; return; }
      await saveShoe(makeShoe(n));
      status.textContent = `Added ${n}. It starts at 0 ${distanceLabel()}.`;
      paint();
    };
    return el("div.row", { style: "margin-top:14px;gap:8px;align-items:center" }, [
      name, el("button.btn", { onclick: add }, "Add pair"),
    ]);
  }

  await paint();
  return card;
}
