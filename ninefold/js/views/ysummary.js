// ysummary.js — one logged yoga practice: what it was, what it stood in for,
// and the two corrections worth making after the fact.
//
// WHY THIS SCREEN EXISTS. A practice was logged from three places and openable
// from none. Today showed a summary card, the Plan week showed a row, Progress
// counted it — and there was no way to see which poses you had actually done,
// no way to fix a practice logged as replacing a session you went on to train
// anyway, and no way to remove an accidental completion at all. `removeYogaDone`
// had been sitting in the store since v171 with no caller.
//
// ⚠ ADDRESSED BY `at`, NOT BY DATE. Several practices a day are allowed and are
// one of the things the feature is for, so a date is not an identity. Every
// entry carries its completion timestamp; that is the id in the URL.
//
// WHAT IS EDITABLE, AND WHY ONLY THIS. Two fields change what the app tells you
// afterwards: how long you practised (adherence, minutes) and what it stood in
// for (whether the week reads as a session done or a session skipped). Intent,
// style and level are facts about the practice you ran — changing them would
// describe a practice that never happened, so they are shown and not offered.

import { el, mount, go, backBtn } from "../ui.js";
import { yogaEntryAt, updateYogaEntry, removeYogaEntry } from "../store.js";
import { illustration } from "../illustrations.js";
import { intentById } from "../yoga/intents.js";
import { styleById } from "../yoga/styles.js";
import { LEVELS } from "../yoga/levels.js";
import { byId as asanaById } from "../yoga/asanas.js";
import { replaceOptionsOn } from "./yoga.js";

function prettyDate(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y) return iso || "";
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function prettyTime(at) {
  const t = new Date(at);
  return isNaN(t) ? "" : t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function toast(msg) {
  const t = el("div.toast", { text: msg });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3200);
}

/**
 * The pose list, collapsing a run of the same shape into "x3" — three rounds of
 * a salutation is one line saying three rounds, not three identical lines that
 * read as a rendering fault.
 */
function runs(sequence) {
  const out = [];
  for (const id of sequence || []) {
    const last = out[out.length - 1];
    if (last && last.id === id) last.n++;
    else out.push({ id, n: 1 });
  }
  return out;
}

export async function renderYSummary(at) {
  const entry = await yogaEntryAt(at);
  if (!entry) {
    return mount([
      backBtn("Yoga", "#/yoga"),
      el("h1", { text: "Practice" }),
      el("div.card", { style: "margin-top:14px" }, [
        el("p.dim", { style: "margin:0", text: "That practice isn't in the log any more — it may already have been deleted." }),
      ]),
    ]);
  }

  const intent = intentById(entry.intent);
  const style = styleById(entry.style);
  const level = LEVELS[entry.level];
  // What THAT day had to offer, not what today has. A summary of last Tuesday
  // must not offer to stand in for this morning's leg day.
  const options = await replaceOptionsOn(entry.date);

  const body = el("div");
  let armed = false;             // delete awaiting its second tap

  const paint = () => {
    const children = [];

    // --- what it was ---
    const stat = (v, l) => el("div", {}, [
      el("div.metric.sm", { text: v }),
      el("div.label", { style: "margin-top:5px", text: l }),
    ]);
    children.push(el("div.card", {}, [
      el("div.row", {}, [
        el("div", { style: "flex:1;min-width:0" }, [
          el("div.label", { text: (style ? style.name : entry.style) + (level ? " · " + level.label : "") }),
          el("div.note", { style: "margin-top:3px",
            text: entry.peakName ? "Peak: " + entry.peakName : "No peak posture" }),
        ]),
        el("span.badge.accent", { text: "✓ Done" }),
      ]),
      el("div.statgrid.three", { style: "margin-top:14px" }, [
        stat(String(entry.minutes), "minutes"),
        stat(String(entry.poses || (entry.sequence || []).length || "–"), "poses"),
        stat("0", "hard sets"),
      ]),
    ]));

    // --- the poses ---
    // Entries logged before the sequence was recorded have none. Say that,
    // rather than showing an empty list that reads as a practice with no poses.
    const seq = runs(entry.sequence);
    children.push(el("div.card", {}, [
      el("h2", { text: "The sequence" }),
      seq.length
        ? el("div.list", { style: "margin-top:10px" }, seq.map(({ id, n }, i) => {
            const a = asanaById(id);
            return el("div.item", {}, [
              el("div.ico.illotile", { style: "padding:0;overflow:hidden" }, [illustration([id, a && a.art])]),
              el("div.meta", {}, [
                el("div.t", { text: (a ? a.name : id) + (n > 1 ? ` ×${n}` : "") }),
                el("div.s", { text: a ? (a.sanskrit || "") : "" }),
              ]),
              el("span.badge", { text: String(i + 1) }),
            ]);
          }))
        : el("p.note", { text: "This practice was logged before the app started keeping the pose list, so only the totals above survive it. Practices from here on record what you did." }),
    ]));

    // --- how long (editable) ---
    // A practice you cut short at ten minutes should not count as thirty. The
    // engine logs the flow's PLANNED length, which is right until it isn't.
    const minIn = el("input", {
      type: "number", inputmode: "numeric", min: "1", max: "180",
      value: String(entry.minutes || ""),
      style: "width:92px;text-align:center",
      "aria-label": "Minutes practised",
    });
    children.push(el("div.card", {}, [
      el("h2", { text: "How long it actually ran" }),
      el("div.row", { style: "gap:10px;margin-top:10px;align-items:center" }, [
        minIn,
        el("span.dim", { text: "minutes" }),
        el("button.btn", { style: "margin-left:auto", onclick: async () => {
          const v = Math.round(Number(minIn.value));
          if (!Number.isFinite(v) || v < 1 || v > 180) { toast("Give it a number of minutes between 1 and 180."); return; }
          await updateYogaEntry(entry.at, { minutes: v, seconds: v * 60 });
          entry.minutes = v; entry.seconds = v * 60;
          toast("Updated.");
          paint();
        } }, "Save"),
      ]),
      el("p.note", { style: "margin-top:10px", text: "Logged as the length of the sequence you started. If you stopped early or stayed longer, correct it here." }),
    ]));

    // --- what it stood in for (editable) ---
    const opts = [{ v: null, label: "Nothing — it was extra", sub: "Counted on top of whatever else that day held." }];
    if (options.mobility) opts.push({ v: "mobility", label: "The mobility & stability session",
      sub: "Cleanly equivalent — same job, same intensity band." });
    if (options.strength) opts.push({ v: "strength", label: `The ${options.strengthLabel || "session"}`,
      sub: "Counts as a session, but adds no hard sets. Progress shows the gap." });
    // The practice may record standing in for something that day no longer
    // offers — the block was deleted, the schedule moved under it, or the
    // tracker was switched off in "What you track". Keep the option visible
    // rather than silently dropping the answer the moment the screen paints,
    // which would present a change nobody made as the truth.
    if (entry.substitutes && !opts.some((o) => o.v === entry.substitutes)) {
      opts.push({ v: entry.substitutes,
        label: entry.substitutes === "mobility" ? "The mobility & stability session" : "That day's session",
        sub: "Not on your plan any more — but it's what this practice was logged against." });
    }
    children.push(el("div.card", {}, [
      el("h2", { text: "Stood in for" }),
      el("div.chipgrid.lim", {}, opts.map((o) =>
        el("button.chip" + (o.v === (entry.substitutes || null) ? ".on" : ""), {
          onclick: async () => {
            if (o.v === (entry.substitutes || null)) return;
            await updateYogaEntry(entry.at, { substitutes: o.v });
            entry.substitutes = o.v;
            toast(o.v === "strength" ? "That day's session now reads as replaced."
              : o.v === "mobility" ? "Logged as the mobility & stability session."
              : "Logged as an extra — that day's session reads as unfinished again.");
            paint();
          },
        }, [
          el("span.chiptitle", { text: o.label }),
          el("span.chipsub", { text: o.sub }),
        ]))),
      opts.length === 1
        ? el("p.note", { text: "Nothing was scheduled on that day for this to have replaced." })
        : null,
    ]));

    // --- delete ---
    // Two taps, and the second one says what it costs. Nothing else has to be
    // healed: yoga touches no progression state, and every place the practice
    // shows up derives from this log at read time, so removing it un-replaces
    // the session by itself.
    children.push(el("div.card", {}, [
      el("h2", { text: "Delete this practice" }),
      el("p.note", { style: "margin-top:6px", text: armed
        ? "Tap Confirm and it's gone. If it stood in for a session, that day goes back to reading as unfinished."
        : "Removes it from the log, this week's adherence and Progress. Nothing else changes." }),
      el("button.btn" + (armed ? ".danger" : ".ghost") + ".block", { style: "margin-top:12px", onclick: async () => {
        if (!armed) { armed = true; paint(); return; }
        await removeYogaEntry(entry.at);
        go("#/yoga");
      } }, armed ? "Confirm delete" : "Delete"),
      armed ? el("button.btn.ghost.block", { style: "margin-top:8px",
        onclick: () => { armed = false; paint(); } }, "Keep it") : null,
    ]));

    body.replaceChildren(...children.filter(Boolean));
  };

  mount([
    backBtn("Yoga", "#/yoga"),
    el("h1", { text: intent ? intent.label : entry.intent }),
    el("div.dim", { style: "margin-top:2px",
      text: prettyDate(entry.date) + (prettyTime(entry.at) ? " · " + prettyTime(entry.at) : "") }),
    body,
  ]);
  paint();
}
