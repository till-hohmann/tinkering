// mobsummary.js — summary of a completed M&S session (the mobility counterpart
// of the workout summary): which session ran, every hold's actual time vs its
// target (worst side is what the progression engine judged), and — for today's
// entry — the Redo path: remove the entry, rebuild the progression state from
// the remaining log (healing anything an accidental click-through moved), and
// drop straight back into the session player.

import { el, mount, go, backBtn } from "../ui.js";
import { mobilityEntryOn, removeMobilityDone, setMobilityProg, getMobilityLog } from "../store.js";
import { todayISO } from "../model.js";
import { sessionByKey, replayMobilityLog, MOBILITY_TITLE, MOBILITY_SESSIONS } from "../mobility.js";
import { illustration } from "../illustrations.js";

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export async function renderMobSummary(iso) {
  const entry = await mobilityEntryOn(iso);
  if (!entry) {
    return mount([backBtn("Today", "#/"), el("h1", { text: MOBILITY_TITLE }),
      el("div.card", { style: "margin-top:14px" }, [el("p.dim", { text: "No M&S session logged on this day." })])]);
  }
  const session = entry.key ? sessionByKey(entry.key) : null;
  const isToday = iso === todayISO();

  const children = [
    backBtn("Today", "#/"),
    el("h1", { text: session ? session.title : MOBILITY_TITLE }),
    el("div.dim", { style: "margin-top:2px", text: prettyDate(iso) + (entry.eased ? " · deload (targets untouched)" : "") }),
  ];

  // per-exercise holds: worst side governs the engine, so show both sides
  const holds = entry.holds || [];
  if (holds.length && session) {
    const byId = new Map();
    for (const h of holds) { if (!byId.has(h.id)) byId.set(h.id, []); byId.get(h.id).push(h); }
    children.push(el("div.list", { style: "margin-top:16px" }, [...byId.entries()].map(([id, recs]) => {
      const item = session.items.find((i) => i.id === id) || { name: id };
      const worst = Math.min(...recs.map((r) => r.heldSec));
      const target = recs[0].targetSec;
      const made = worst >= target;
      const sides = recs.length > 1
        ? recs.map((r) => `${r.side ? r.side[0] : ""} ${r.heldSec}s`).join(" · ")
        : `${recs[0].heldSec}s`;
      return el("div.item", {}, [
        el("div.ico", {}, [illustration(id)]),
        el("div.meta", {}, [
          el("div.t", { text: item.name }),
          el("div.s", { text: `${sides} — target ${target}s` }),
        ]),
        el("span.badge" + (made ? ".accent" : ""), {
          style: made ? "" : "color:var(--amber);border-color:rgba(251,191,36,.4)",
          text: made ? "✓ Held" : `${worst}/${target}s` }),
      ]);
    })));
  } else {
    children.push(el("div.card", { style: "margin-top:14px" }, [
      el("p.dim", { style: "margin:0", text: "Completed — no hold times were recorded for this session." })]));
  }

  if (isToday && session) {
    children.push(el("button.btn.primary.big.block", { style: "margin-top:16px", onclick: async () => {
      // remove today's entry, heal the progression state from the remaining log,
      // then straight back into the player. Exiting with ✕ keeps it un-done.
      await removeMobilityDone(iso);
      await setMobilityProg(replayMobilityLog(await getMobilityLog()));
      const wd = Object.keys(MOBILITY_SESSIONS).find((d) => MOBILITY_SESSIONS[d].key === entry.key) || "Wed";
      go(`#/mobility/${wd}`);
    } }, "Redo session"));
    children.push(el("p.note.center", { style: "margin-top:8px",
      text: "Redo clears this completion and restores the hold targets it moved. Exit with ✕ if you'd rather do it later — it stays reset." }));
  }

  mount(children);
}
