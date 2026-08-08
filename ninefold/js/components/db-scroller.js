// db-scroller.js — weight stepper for dumbbells (per-hand, pair-aware, location-
// specific) and cable (requirements §8). Supports both a fixed increment and a
// DISCRETE value list (e.g. a set of adjustable dumbbells). getValue() returns the
// LOGGED value: per-hand for dumbbells, stack value for cable.

import { el, clear, haptic } from "../ui.js";
import { weightValue, weightLabel } from "../units.js";

// `profile` drives display only; every value stays kg internally.
export function WeightStepper(implement, equip, location, initial, onChange, profile) {
  let mode, values, cfg;

  if (implement === "cable") {
    mode = "cont";
    cfg = { min: equip.cable?.minKg ?? 2.5, max: equip.cable?.maxKg ?? 120,
      step: equip.cable?.stepKg ?? 2.5, micro: equip.cable?.microStepKg };
  } else {
    const db = (equip.dumbbells && equip.dumbbells[location]) || equip.dumbbells || {};
    if (Array.isArray(db.valuesKg) && db.valuesKg.length) {
      mode = "disc";
      values = [...db.valuesKg].sort((a, b) => a - b);
    } else {
      mode = "cont";
      cfg = { min: db.minKg != null ? db.minKg : 0, max: db.maxKg ?? 30, step: db.stepKg ?? 0.5 };
    }
  }

  const snapDisc = (v) => values.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), values[0]);
  const clampCont = (v) => {
    const s = cfg.micro || cfg.step;
    return Math.min(cfg.max, Math.max(cfg.min, Math.round(v / s) * s));
  };

  let val = mode === "disc" ? snapDisc(initial != null ? initial : values[0]) : clampCont(initial != null ? initial : cfg.min);

  const reading = el("div.reading");
  function draw() {
    clear(reading);
    const u = weightLabel(profile);
    const d = (kg) => trim(weightValue(kg, profile));
    reading.appendChild(el("div.w", { text: `${d(val)} ${u}` }));
    if (implement === "dumbbell_pair") reading.appendChild(el("div.eff", { text: `2 × ${d(val)} → ${d(val * 2)} ${u} effective` }));
    else if (implement === "dumbbell_single") reading.appendChild(el("div.eff", { text: "single dumbbell" }));
    else reading.appendChild(el("div.eff", { text: "cable stack" }));
  }

  function bump(dir) {
    if (mode === "disc") {
      let i = values.indexOf(val);
      if (i < 0) { val = snapDisc(val); i = values.indexOf(val); }
      i = Math.min(values.length - 1, Math.max(0, i + dir));
      val = values[i];
    } else {
      val = clampCont(val + dir * cfg.step);
    }
    draw(); haptic(8); onChange && onChange(val);
  }
  function microBump(d) { val = clampCont(val + d); draw(); haptic(8); onChange && onChange(val); }

  const main = el("div.scroller", {}, [
    el("button.stepbtn", { onclick: () => bump(-1) }, "−"),
    reading,
    el("button.stepbtn", { onclick: () => bump(1) }, "+"),
  ]);

  const children = [main];
  if (mode === "cont" && cfg.micro && cfg.micro !== cfg.step) {
    children.push(el("div.btn-row", { style: "max-width:240px;margin:0 auto" }, [
      el("button.btn", { onclick: () => microBump(-cfg.micro) }, `−${trim(cfg.micro)}`),
      el("button.btn", { onclick: () => microBump(cfg.micro) }, `+${trim(cfg.micro)}`),
    ]));
  }

  draw();
  return {
    node: el("div", {}, children),
    getValue: () => val,
    setValue: (v) => { val = mode === "disc" ? snapDisc(v) : clampCont(v); draw(); },
  };
}

function trim(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
