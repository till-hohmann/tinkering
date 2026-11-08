// nutrition.js — daily fuel log. Calories IN (logged manually, e.g. from
// a food-tracker daily total) vs calories OUT (your tracker's day burn) = energy
// balance, plus protein vs a bodyweight-based target and carbs/fat. No calorie
// target by choice — the balance is shown raw. Any day (today or past) can be
// edited via the date stepper.

import { getNutrition, setNutrition, getBodyweight, getProteinPerKg, getDeficitTarget, getNutritionLog, importNutritionDays } from "../store.js";
import { addDaysISO as addDays } from "../dates.js";
import { todayISO } from "../model.js";
import * as M from "../model.js";
import { el, mount, go, backBtn, addActionBar, setChildren } from "../ui.js";
import { burnFor, provider, has, CAP } from "../health/index.js";

const inStyle = "width:120px;text-align:right;font-size:1.2rem;font-weight:700;padding:10px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)";

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export async function renderNutrition(dateParam) {
  const today = todayISO();
  const iso = dateParam || today;
  const isToday = iso === today;
  const [entry, bodyweight, perKg, deficitTarget] = await Promise.all([getNutrition(iso), getBodyweight(), getProteinPerKg(), getDeficitTarget()]);
  const proteinTarget = bodyweight ? Math.round(perKg * bodyweight) : null;

  const fields = {
    kcal: el("input", { type: "text", inputmode: "numeric", placeholder: "kcal", value: entry && entry.kcal != null ? String(entry.kcal) : "", style: inStyle , "aria-label": "Calories in kcal" }),
    protein: el("input", { type: "text", inputmode: "numeric", placeholder: "g", value: entry && entry.protein != null ? String(entry.protein) : "", style: inStyle , "aria-label": "Protein in grams" }),
    carbs: el("input", { type: "text", inputmode: "numeric", placeholder: "g", value: entry && entry.carbs != null ? String(entry.carbs) : "", style: inStyle , "aria-label": "Carbohydrate in grams" }),
    fat: el("input", { type: "text", inputmode: "numeric", placeholder: "g", value: entry && entry.fat != null ? String(entry.fat) : "", style: inStyle , "aria-label": "Fat in grams" }),
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
    "aria-label": "Pick a day to log food for",
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
  let burn = null, burnLoaded = false, canBurn = true;
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
    setChildren(summary,
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
        : !canBurn ? "Calories out need a tracker (WHOOP or Apple Health) — without one, compare intake against your own maintenance estimate."
        : (burnLoaded ? "No burn recorded for this day yet — it fills in once your tracker has the full day." : "Loading your burn…") }),
    );
  }

  const status = el("p.note.center", { style: "min-height:1.1em;margin-top:10px" });

  mount([
    el("div", {}, [
      backBtn("Today", "#/"),
      el("div.label", { style: "margin-top:8px", text: "Fuel" }),
      stepper,
      el("p.dim", { style: "margin-top:8px", text: "Copy your day's totals from your food tracker." }),
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
    mfpImportCard(),
  ]);

  Object.values(fields).forEach((i) => i.addEventListener("input", refreshSummary));
  refreshSummary();
  // load the burn once, then refresh the summary
  (async () => {
    try { canBurn = await has(CAP.burn); burn = canBurn ? await burnFor(iso) : null; } catch { burn = null; }
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

// Load a MyFitnessPal export (the emailed .zip, or the Nutrition Summary .csv
// inside it). Re-importing an overlapping range is the normal use: the export is
// the record for the days it covers, so those days are added or brought up to
// date and every other day is left alone. Says what it will do before doing it.
function mfpImportCard() {
  const note = el("p.note", { style: "margin-top:8px;min-height:1.1em" });
  const actions = el("div.btn-row", { style: "margin-top:8px" });
  const input = el("input", { type: "file", accept: ".zip,.csv,text/csv,application/zip", style: "display:none",
    "aria-label": "Choose a MyFitnessPal export" });
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    setChildren(actions, []);
    note.textContent = "Reading " + file.name + "…";
    try {
      const { readMfpFile, planMfpImport } = await import("../mfp-import.js");
      const r = await readMfpFile(file);
      if (r.error) { note.textContent = r.error; return; }
      const plan = planMfpImport(r.days, await getNutritionLog());
      const dates = Object.keys(r.days).sort();
      const todo = plan.add.length + plan.update.length;
      const span = dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + " to " + dates[dates.length - 1];
      if (!todo) { note.textContent = `${span}: every day already matches — nothing to import.`; return; }
      note.textContent = `${span}: ${plan.add.length} new day(s), ${plan.update.length} updated, ${plan.same.length} unchanged.`;
      setChildren(actions, [el("button.btn.primary", { onclick: async () => {
        const pick = {};
        for (const d of [...plan.add, ...plan.update]) pick[d] = r.days[d];
        await importNutritionDays(pick);
        setChildren(actions, []);
        note.textContent = `Imported ${todo} day(s) ✓`;
      } }, `Import ${todo} day(s)`)]);
    } catch (e) { note.textContent = "Couldn't read that file: " + (e.message || e); }
  });
  return el("div.card", { style: "margin-top:14px" }, [
    el("div.label", { text: "Import from MyFitnessPal" }),
    el("p.note", { style: "margin-top:4px", text:
      "Request a data export in MyFitnessPal (a Premium feature) for the dates you want, then open the zip it emails you here, or the Nutrition Summary .csv inside it. Days in the export are added or updated; nothing else is touched." }),
    el("button.btn.block", { style: "margin-top:10px", onclick: () => input.click() }, "Choose export…"),
    input, note, actions,
  ]);
}
