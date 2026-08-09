// nutrition.js — daily fuel log. Calories IN (logged manually, e.g. from
// a food-tracker daily total) vs calories OUT (your tracker's day burn) = energy
// balance, plus protein vs a bodyweight-based target and carbs/fat. No calorie
// target by choice — the balance is shown raw. Any day (today or past) can be
// edited via the date stepper.

import { getNutrition, setNutrition, getBodyweight, getProteinPerKg, getDeficitTarget } from "../store.js";
import { todayISO } from "../model.js";
import * as M from "../model.js";
import { el, mount, go, backBtn, addActionBar } from "../ui.js";
import { burnFor, provider, has, CAP } from "../health/index.js";

const inStyle = "width:120px;text-align:right;font-size:1.2rem;font-weight:700;padding:10px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)";

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export async function renderNutrition(dateParam) {
  const today = todayISO();
  const iso = dateParam || today;
  const isToday = iso === today;
  const [entry, bodyweight, perKg, deficitTarget] = await Promise.all([getNutrition(iso), getBodyweight(), getProteinPerKg(), getDeficitTarget()]);
  const proteinTarget = bodyweight ? Math.round(perKg * bodyweight) : null;

  const fields = {
    kcal: el("input", { type: "text", inputmode: "numeric", placeholder: "kcal", value: entry && entry.kcal != null ? String(entry.kcal) : "", style: inStyle }),
    protein: el("input", { type: "text", inputmode: "numeric", placeholder: "g", value: entry && entry.protein != null ? String(entry.protein) : "", style: inStyle }),
    carbs: el("input", { type: "text", inputmode: "numeric", placeholder: "g", value: entry && entry.carbs != null ? String(entry.carbs) : "", style: inStyle }),
    fat: el("input", { type: "text", inputmode: "numeric", placeholder: "g", value: entry && entry.fat != null ? String(entry.fat) : "", style: inStyle }),
  };
  // gentle validation: flag non-numeric junk (a comma/dot is fine) so a typo isn't
  // silently parsed to 0 without the user noticing.
  Object.values(fields).forEach((inp) => {
    const check = () => { inp.style.borderColor = inp.value && /[^\d.,\s]/.test(inp.value) ? "var(--coral)" : ""; };
    inp.addEventListener("input", check); check();
  });
  const row = (label, input, hint) => el("div.row", { style: "margin:12px 0" }, [
    el("div", {}, [el("div", { text: label }), hint ? el("div.faint", { style: "font-size:.78rem", text: hint }) : null]),
    el("span.spacer"), input,
  ]);

  // date stepper — ‹ › step a day, tap the date for a native picker to jump to
  // any past day (next/future disabled).
  const picker = el("input", { type: "date", value: iso, max: today,
    style: "position:absolute;opacity:0;width:1px;height:1px;pointer-events:none" });
  picker.addEventListener("change", () => { if (picker.value) go("#/nutrition/" + picker.value); });
  const dateBtn = el("button.smid", { style: "background:none;border:none;color:inherit;cursor:pointer",
    onclick: () => { try { picker.showPicker(); } catch { picker.click(); } } }, [
    el("div", { style: "font-weight:700", text: isToday ? "Today" : prettyDate(iso).replace(/,.*/, "") }),
    el("div.faint", { style: "font-size:.8rem", text: prettyDate(iso) + " · tap to pick" }),
  ]);
  const stepper = el("div.stepper", {}, [
    el("button.sbtn", { onclick: () => go("#/nutrition/" + addDays(iso, -1)) }, "‹"),
    dateBtn, picker,
    el("button.sbtn", isToday ? { disabled: true } : { onclick: () => go("#/nutrition/" + addDays(iso, 1)) }, "›"),
  ]);

  // Tracked burn for this day — fetched ONCE (cached); the summary recomputes from
  // the cached value on every keystroke. Paginates enough to cover past days.
  let burn = null, burnLoaded = false;
  const summary = el("div.card", { style: "margin-top:4px" }, [el("p.note", { style: "margin:0", text: "Loading your burn…" })]);
  function refreshSummary() {
    const kcalIn = M.parseNum(fields.kcal.value);
    const protein = M.parseNum(fields.protein.value);
    const balance = burn != null && kcalIn ? kcalIn - burn : null;
    const verdict = M.energyBalanceVerdict(balance, deficitTarget);
    const stat = (label, value, color) => el("div", {}, [
      el("div.metric.sm", { style: color ? "color:" + color : "", text: value }),
      el("div.label", { style: "margin-top:5px", text: label }),
    ]);
    summary.replaceChildren(
      el("div.row", {}, [
        el("div.label", { text: isToday ? "Energy balance today" : "Energy balance" }),
        el("span.spacer"),
        verdict ? el("span.badge", { style: `color:${verdict.color};border-color:${verdict.color}55`, text: verdict.label }) : null,
      ]),
      el("div.statgrid.three", { style: "margin-top:14px" }, [
        stat("In", kcalIn ? String(Math.round(kcalIn)) : "–"),
        stat("Out", burn != null ? String(burn) : (burnLoaded ? "–" : "…")),
        stat("Balance", balance != null ? (balance > 0 ? "+" : "") + Math.round(balance) : "–",
          verdict ? verdict.color : null),
      ]),
      proteinTarget != null
        ? el("div.note", { style: "margin-top:12px",
            text: `Protein ${protein ? Math.round(protein) : 0} / ${proteinTarget} g target` + (protein >= proteinTarget && protein ? " ✓" : "") })
        : el("div.note", { style: "margin-top:12px", text: "Set your bodyweight in Profile to get a protein target." }),
      el("p.note", { style: "margin-top:6px;font-size:.74rem", text: burn != null
        ? `Out = your tracker's day burn (BMR + activity). Recomp target: ~${deficitTarget} kcal/day deficit.`
        : (burnLoaded ? "No burn recorded for this day." : "Connect a tracker for the burn side.") }),
    );
  }

  const status = el("p.note.center", { style: "min-height:1.1em;margin-top:10px" });

  mount([
    el("div", {}, [
      backBtn("Today", "#/"),
      el("div.label", { style: "margin-top:8px", text: "Fuel" }),
      stepper,
      el("p.dim", { style: "margin-top:8px", text: "Copy your totals from MyFitnessPal." }),
    ]),
    summary,
    el("div.card", { style: "margin-top:14px" }, [
      el("div.label", { style: "margin-bottom:4px", text: "Log" }),
      row("Carbs", fields.carbs, "g"),
      row("Fat", fields.fat, "g"),
      row("Protein", fields.protein, proteinTarget != null ? `g · target ${proteinTarget}` : "g"),
      row("Calories", fields.kcal, "kcal"),
    ]),
    status,
  ]);

  Object.values(fields).forEach((i) => i.addEventListener("input", refreshSummary));
  refreshSummary();
  // load the burn once, then refresh the summary
  (async () => {
    try { burn = await burnFor(iso); } catch { burn = null; }
    burnLoaded = true; refreshSummary();
  })();

  addActionBar(el("button.btn.primary.big.block", { onclick: async () => {
    await setNutrition(iso, {
      kcal: M.parseNum(fields.kcal.value), protein: M.parseNum(fields.protein.value),
      carbs: M.parseNum(fields.carbs.value), fat: M.parseNum(fields.fat.value),
    });
    status.textContent = `Saved ${isToday ? "today" : prettyDate(iso).replace(/,.*/, "")} ✓`;
  } }, "Save"));
}
