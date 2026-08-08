// plate-calc.js — illustrated barbell / EZ-bar plate picker (requirements §8).
// Tap a plate denomination to add it to BOTH sides; tap a loaded plate to remove.
// Logged value = total bar weight (bar + plates*2).

import { el, clear, haptic } from "../ui.js";
import { plateColor, plateLabel, weightValue, weightLabel, isImperialWeight } from "../units.js";

const heightFor = (kg) => 34 + Math.min(60, kg * 2.4); // px, scales with denomination

// `profile` drives display only — every denomination and total stays in kg
// internally, so an imperial rack is a real set of lb plates expressed in kg and
// the arithmetic never changes.
export function PlateCalc(implement, equip, initialTotal, onChange, profile) {
  const bar = implement === "ez_bar" ? (equip.ezBarWeightKg ?? 7.5) : (equip.barWeightKg ?? 20);
  const denoms = (implement === "ez_bar" ? equip.ezBarPlatesKg : equip.barbellPlatesKg) || [25,20,15,10,5,2.5,1.25];
  let perSide = decompose(initialTotal, bar, denoms);

  const vis = el("div.bar-vis");
  const totalEl = el("div.bigtotal");
  const picker = el("div.platepick");

  function total() { return bar + perSide.reduce((a, b) => a + b, 0) * 2; }

  // kg -> the number shown on screen, in whichever system the profile uses.
  const disp = (kg) => trim(weightValue(kg, profile));
  // The one pale plate needs dark text: 5 kg on a metric rack, 10 lb on an
  // imperial one.
  const lightFace = (kg) => {
    const v = weightValue(kg, profile);
    return isImperialWeight(profile) ? v === 10 : v === 5;
  };

  function emit() { onChange && onChange(total()); }

  function drawVisual() {
    clear(vis);
    const sorted = [...perSide].sort((a, b) => b - a); // largest inside
    // left side: largest near the core -> render reversed
    const left = [...sorted].reverse();
    left.forEach((kg) => vis.appendChild(plateEl(kg, () => removeOne(kg))));
    vis.appendChild(el("div.bar-sleeve"));
    vis.appendChild(el("div.bar-core"));
    vis.appendChild(el("div.bar-sleeve"));
    sorted.forEach((kg) => vis.appendChild(plateEl(kg, () => removeOne(kg))));
  }

  function plateEl(kg, onClick) {
    return el("div.plate", {
      style: `height:${heightFor(kg)}px;background:${plateColor(kg, profile)};color:${lightFace(kg) ? "#111" : ""}`,
      onclick: () => { onClick(); haptic(10); },
      title: `${plateLabel(kg, profile)} ${weightLabel(profile)}`,
    }, [plateLabel(kg, profile).replace(".25", "¼").replace(".5", "½")]);
  }

  function drawTotal() {
    clear(totalEl);
    const perSideKg = perSide.reduce((a, b) => a + b, 0);
    const u = weightLabel(profile);
    totalEl.appendChild(el("span", { text: `${disp(total())} ${u}` }));
    totalEl.appendChild(el("div", {}, [el("small", { text: `${disp(perSideKg)} ${u}/side · bar ${disp(bar)} ${u}` })]));
  }

  function addOne(kg) { perSide.push(kg); redraw(); }
  function removeOne(kg) {
    const i = perSide.indexOf(kg);
    if (i >= 0) perSide.splice(i, 1);
    redraw();
  }
  function redraw() { drawVisual(); drawTotal(); emit(); }

  denoms.forEach((kg) =>
    picker.appendChild(el("button.plate-btn", { onclick: () => { addOne(kg); haptic(10); } }, "+" + plateLabel(kg, profile)))
  );

  const node = el("div", {}, [vis, totalEl, picker,
    el("p.note.center", { style: "margin-top:8px", text: "Tap a plate above to remove it" })]);
  drawVisual(); drawTotal();

  return {
    node,
    getValue: () => total(),
    setTotal: (t) => { perSide = decompose(t, bar, denoms); redraw(); },
  };
}

// greedy decompose of a total into per-side plates
function decompose(total, bar, denoms) {
  let rem = Math.max(0, ((Number(total) || bar) - bar) / 2);
  const out = [];
  const sorted = [...denoms].sort((a, b) => b - a);
  for (const d of sorted) {
    while (rem + 1e-9 >= d) { out.push(d); rem -= d; }
  }
  return out;
}

function trim(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
