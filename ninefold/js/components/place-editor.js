// place-editor.js — "what's at this gym?", asked identically wherever it's asked.
//
// It is asked in two places, which is why this is a component and not a chunk of
// the builder:
//   - the builder's equipment step, describing the places you normally train
//   - the start of a session, when you're somewhere new and the plan has to bend
//
// WHY THE LIST IS LONG. It used to offer five chips — barbell, dumbbells, cable,
// EZ bar, machines — and take "barbell" to imply a rack and a bench. A garage
// with a bar on the floor was therefore prescribed back squats and bench press,
// which is not a small mistake: it's the first session, and it doesn't work. So
// STATIONS are asked separately (see equipment.js), and the presets exist because
// "which of these four is you?" is a far better opening question than fifteen
// checkboxes — you pick the closest and correct it.

import { el } from "../ui.js";
import { IMPLEMENTS, STATIONS, MACHINES, PRESETS, SURVEYED, MACHINE_IMPLEMENT } from "../equipment.js";
import { defaultEquipmentFor, weightValue, weightToKg, weightLabel,
  IMPERIAL_EQUIPMENT, METRIC_EQUIPMENT, rackFields } from "../units.js";

const FIELD = "width:100%;padding:11px 13px;background:var(--bg-elev2);border:1px solid var(--line);" +
  "border-radius:11px;color:var(--text);font-size:.95rem";
const NUM = "width:78px;text-align:center;padding:8px;background:var(--bg-elev2);" +
  "border:1px solid var(--line);border-radius:10px;color:var(--text)";

/** A blank place carrying the stock rack for the profile's units. */
export function blankPlace(profile, name = "") {
  const kit = defaultEquipmentFor(profile);
  return {
    name,
    implements: ["bodyweight"],
    barWeightKg: kit.barWeightKg, ezBarWeightKg: kit.ezBarWeightKg,
    barbellPlatesKg: [...kit.barbellPlatesKg], ezBarPlatesKg: [...kit.ezBarPlatesKg],
    cable: { ...kit.cable }, dumbbells: { ...kit.dumbbells },
  };
}

/** Normalise before saving: a name, bodyweight always, single bells with pairs. */
export function tidyPlace(place, profile, fallbackName = "Gym") {
  const kit = defaultEquipmentFor(profile);
  // Stamped here, not in the UI: anything this editor writes HAS been asked
  // about stations, including when the answer was "none of them".
  const imps = new Set([...(place.implements || []), "bodyweight", SURVEYED]);
  // One bell out of a pair rack is always available, and several lifts need
  // exactly that — so it rides along rather than being a question of its own.
  if (imps.has("dumbbell_pair")) imps.add("dumbbell_single"); else imps.delete("dumbbell_single");
  // Any individual machine implies the machine implement the library gates on.
  if (MACHINES.some(([id]) => imps.has(id))) imps.add(MACHINE_IMPLEMENT); else imps.delete(MACHINE_IMPLEMENT);
  return {
    barWeightKg: kit.barWeightKg, ezBarWeightKg: kit.ezBarWeightKg,
    barbellPlatesKg: [...kit.barbellPlatesKg], ezBarPlatesKg: [...kit.ezBarPlatesKg],
    cable: { ...kit.cable },
    ...place,
    name: (place.name || "").trim() || fallbackName,
    implements: [...imps],
  };
}

/**
 * Renders the editor for one place into a node. Mutates `place` in situ and
 * calls onChange() after every edit so a caller can enable/disable its own
 * action button. `compact` drops the preset row (used mid-session, where the
 * question is "what's here?" rather than "describe your gyms").
 */
export function placeEditor(place, profile, { onChange = () => {}, compact = false, nameLabel = "What's it called?" } = {}) {
  const host = el("div");

  const has = (id) => (place.implements || []).includes(id);
  const toggle = (id) => {
    const on = has(id);
    place.implements = on ? place.implements.filter((x) => x !== id) : [...place.implements, id];
    if (id === "dumbbell_pair") {
      place.implements = place.implements.filter((x) => x !== "dumbbell_single");
      if (!on) place.implements.push("dumbbell_single");
    }
    // keep the implied machine implement in step with the individual ticks
    place.implements = place.implements.filter((x) => x !== MACHINE_IMPLEMENT);
    if (MACHINES.some(([m]) => place.implements.includes(m))) place.implements.push(MACHINE_IMPLEMENT);
    render();
    onChange();
  };

  function chipRow(options) {
    return el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:9px" },
      options.map(([id, label]) =>
        el("button.progchip" + (has(id) ? ".on" : ""), {
          "aria-pressed": has(id) ? "true" : "false",
          onclick: () => toggle(id),
        }, label)));
  }

  function render() {
    const kids = [];

    if (!compact) {
      kids.push(el("div.label", { text: nameLabel }));
      kids.push(el("input", { type: "text", value: place.name || "", placeholder: "Gym, Home, Hotel…",
        style: FIELD + ";margin-top:6px", oninput: (e) => { place.name = e.target.value; onChange(); } }));
    }

    // presets first — most people are one of these, and correcting a near-miss
    // beats building the answer from nothing
    if (!compact) {
      kids.push(el("div.label", { style: "margin-top:16px", text: "Start from" }));
      kids.push(el("p.note", { style: "margin-top:4px", text:
        "Pick the closest, then correct it below. Each one says exactly what it ticks." }));
      kids.push(el("div.list", { style: "margin-top:9px" },
        PRESETS.map(([label, sub, ids]) =>
          el("button.item", { style: "text-align:left",
            onclick: () => { place.implements = [...ids]; render(); onChange(); } }, [
            el("div.meta", {}, [el("div.t", { text: label }), el("div.s", { text: sub })]),
          ]))));
    }

    // WHICH PLATES ARE ON THE BAR HERE — a per-place fact, not a display setting.
    //
    // Units are chosen once for the whole app, and the stock rack followed them.
    // That is right until you travel: a gym in the US has 45/25/10/5 lb plates
    // whether or not you read in kilos, and prescribing 62.5 kg there asks for a
    // weight the bar cannot make. Your logged numbers and every screen stay in
    // your own units — only what this rack can physically load changes.
    const imperialRack = Math.abs((place.barWeightKg || 0) - IMPERIAL_EQUIPMENT.barWeightKg) < 0.5;
    kids.push(el("div.label", { style: "margin-top:16px", text: "Plates on the bar" }));
    kids.push(el("p.note", { style: "margin-top:4px", text:
      "Only matters if this gym's kit is from the other system — a US gym on a metric profile, or the reverse." }));
    kids.push(el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:9px" },
      [["metric", "Metric (20 kg bar)"], ["imperial", "Pounds (45 lb bar)"]].map(([sys, label]) =>
        el("button.progchip" + ((sys === "imperial") === imperialRack ? ".on" : ""), {
          "aria-pressed": ((sys === "imperial") === imperialRack) ? "true" : "false",
          onclick: () => {
            Object.assign(place, rackFields(sys === "imperial" ? IMPERIAL_EQUIPMENT : METRIC_EQUIPMENT));
            render(); onChange();
          },
        }, label))));

    kids.push(el("div.label", { style: "margin-top:16px", text: "What can you load?" }));
    kids.push(el("p.note", { style: "margin-top:4px", text: "What you pick up and press. Bodyweight is always assumed." }));
    kids.push(chipRow(IMPLEMENTS.map(([id, label]) => [id, label])));

    kids.push(el("div.label", { style: "margin-top:16px", text: "Benches, racks & bars" }));
    kids.push(el("p.note", { style: "margin-top:4px", text:
      "The things you rack out of, lie on or hang from. Without a bench there's no bench press; without a bar overhead there are no pull-ups." }));
    kids.push(chipRow(STATIONS.map(([id, label]) => [id, label])));

    kids.push(el("div.label", { style: "margin-top:16px", text: "Machines" }));
    kids.push(el("p.note", { style: "margin-top:4px", text:
      "Tick only the ones you've actually got. Each unlocks its own exercises — nothing here is implied by the others." }));
    kids.push(chipRow(MACHINES.map(([id, label]) => [id, label])));

    // Only worth asking once there are dumbbells, and it's the single most
    // load-limiting fact about a home gym.
    if (has("dumbbell_pair") || has("dumbbell_single")) {
      const base = defaultEquipmentFor(profile).dumbbells;
      kids.push(el("div.row", { style: "margin-top:16px;align-items:center;gap:8px" }, [
        el("div", { style: "flex:1" }, [
          el("div", { text: "Heaviest dumbbell" }),
          el("div.faint", { style: "font-size:.76rem", text: "per hand — stops the app prescribing a weight you don't own" })]),
        el("input", { type: "text", inputmode: "decimal",
          value: String(weightValue((place.dumbbells && place.dumbbells.maxKg) || base.maxKg, profile)),
          style: NUM,
          oninput: (e) => {
            const kg = weightToKg(e.target.value, profile);
            place.dumbbells = { minKg: base.minKg, stepKg: base.stepKg, maxKg: kg && kg > 0 ? kg : base.maxKg };
            onChange();
          } }),
        el("span.dim", { text: weightLabel(profile) }),
      ]));
    }

    const loadable = (place.implements || []).filter((x) => x !== "bodyweight" && x !== "dumbbell_single"
      && x !== SURVEYED && !STATIONS.some(([s]) => s === x) && !MACHINES.some(([m]) => m === x));
    if (!loadable.length) {
      kids.push(el("p.note", { style: "margin-top:14px", text:
        "Bodyweight only — the plan will use holds, jumps and bodyweight movements here. That's a real program, not a downgrade." }));
    }

    host.replaceChildren(...kids);
  }

  render();
  return host;
}
