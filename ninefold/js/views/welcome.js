// views/welcome.js — first-run onboarding.
//
// The app ships empty, so this is the first thing anyone sees. Its job is to
// collect the few facts that change how the app BEHAVES, and nothing else:
//
//   units      — because logging 135 in a kg-only app is silently wrong
//   sex        — the strength benchmark hides itself without it, rather than
//                scoring half of all users against the wrong ratios
//   birth year — the only input to the max-HR estimate, which drives every
//                cardio zone
//   features   — which of the optional trackers (measurements, DEXA, nutrition,
//                mobility) they actually want to see
//   tracker    — WHOOP, Apple, or none
//
// Everything else is deferred. Bodyweight, goal, places and heart-rate zones all
// have sensible empty behaviour and better homes (the builder asks about
// equipment; Settings owns the rest), and an onboarding that asks twelve
// questions before showing anything is one people abandon.
//
// Every step is skippable. A profile with nothing set is a working app: the
// benchmark card hides, zones fall back to a labelled estimate, optional
// features stay off.

import { el, mount, go, backBtn, addActionBar, clear, setChildren } from "../ui.js";
import { getProfile, patchProfile, defaultProfile, TRACKED_FEATURES } from "../profile.js";
import { PROVIDERS, resetProviderCache } from "../health/index.js";
import { THEMES, applyTheme, DEFAULT_THEME } from "../theme.js";
import { todayISO } from "../model.js";

let S = null;

const STEPS = ["intro", "about", "track", "tracker", "done"];

export async function renderWelcome() {
  const profile = (await getProfile()) || defaultProfile();
  if (!S) {
    S = {
      step: 0,
      units: { ...profile.units },
      sex: profile.sex,
      birthYear: profile.birthYear,
      features: { ...profile.features },
      tracker: (profile.tracker && profile.tracker.provider) || "none",
      theme: profile.theme || DEFAULT_THEME,
    };
  }
  draw();
}

function draw() {
  const stage = el("div.stage");
  mount([stage]);
  const key = STEPS[S.step];
  if (S.step > 0) {
    const dots = el("div", { style: "display:flex;gap:5px;margin:14px 0 18px" },
      STEPS.slice(1).map((_, i) => el("div", { style:
        `flex:1;height:3px;border-radius:2px;background:${i <= S.step - 1 ? "var(--accent)" : "var(--bg-elev3)"}` })));
    const back = backBtn("Back", "#");
    back.onclick = () => { S.step--; draw(); };
    back.setAttribute("aria-label", "Back a step");
    stage.append(back, dots);
  }
  const body = el("div");
  stage.appendChild(body);
  ({ intro, about, track, tracker, done })[key](body);
}

const next = () => { S.step = Math.min(STEPS.length - 1, S.step + 1); draw(); };
const bar = (label, onClick, secondary) =>
  addActionBar(...(secondary ? [secondary, el("button.btn.primary.big.block", { onclick: onClick }, label)]
                             : [el("button.btn.primary.big.block", { onclick: onClick }, label)]));

// --- intro -------------------------------------------------------------------
// Carries the health disclaimer. It goes FIRST, before any data is collected —
// putting it in a Settings sub-page nobody opens would be the kind of compliance
// that exists to be pointed at rather than read.
function intro(body) {
  body.append(
    el("div", { style: "padding-top:26px" }, [
      el("h1", { style: "margin:0;font-size:2.1rem", text: "Ninefold" }),
      el("p.dim", { style: "margin-top:10px;font-size:1.02rem;line-height:1.55", text:
        "A training app that writes your plan, runs each session with you, and adjusts the loads from what you actually lift." }),
    ]),
    el("div.card", { style: "margin-top:26px" }, [
      el("div.label", { text: "Three things to know" }),
      point("It's yours", "Everything stays on this device unless you connect a backup you control. No account, no sign-up, nothing sent anywhere."),
      point("It works offline", "The whole app runs with no connection — which is what you want in a basement gym."),
      point("It's not medical advice", "This is general fitness software. If you're carrying an injury, in pain that changes with load, or coming back from surgery, get a plan from a physio instead — and talk to a doctor before starting anything new."),
    ]),
    el("p.note.center", { style: "margin-top:18px", text: "Takes about a minute. You can skip any of it." }),
  );
  bar("Get started", next, el("button.btn.big.block", { onclick: restore }, "I already have a backup"));
}

// --- restore from a backup ---------------------------------------------------
// The escape hatch for a device that has been wiped — a new phone, or an app
// removed and re-added to change its icon, which on iOS is the only way to change
// an icon and takes IndexedDB with it.
//
// This has to live HERE, before onboarding, and that is the whole point. Restored
// settings are applied add-if-missing, so anything onboarding writes first WINS
// and the real value is refused: finish setup and your zones, goal, places and
// routine are replaced by the answers you just gave, permanently. Onboarding also
// hides the tab bar, so on a fresh install there is no route to Settings to enter
// a backup from — this screen was the missing way back.
function restore() {
  const stage = document.querySelector(".stage") || document.body;
  const field = (label, node) => el("div", { style: "margin-top:14px" }, [
    el("div.faint", { style: "font-size:.72rem;margin-bottom:4px", text: label }), node]);
  const inStyle = "width:100%;padding:11px 13px;background:var(--bg-elev2);border:1px solid var(--line);"
    + "border-radius:11px;color:var(--text);font-size:.9rem";
  const epIn = el("input", { type: "text", inputmode: "url", placeholder: "https://your-backup.workers.dev", style: inStyle });
  const tokIn = el("input", { type: "password", placeholder: "your backup token", style: inStyle });
  const status = el("p.note", { style: "margin-top:12px;min-height:1.2em" });

  clear(stage);
  const back = backBtn("Back", "#");
  back.onclick = () => { document.querySelector(".actionbar")?.remove(); draw(); };
  stage.append(
    back,
    el("h1", { style: "margin:8px 0 0", text: "Restore from your backup" }),
    el("p.dim", { text: "If you've used the app before and set up a cloud backup, put its details in here and everything comes back — training history, plans, settings. Do this BEFORE setting up, not after." }),
    el("div.card", { style: "margin-top:16px" }, [field("WORKER URL", epIn), field("TOKEN", tokIn), status]),
    el("p.note", { style: "margin-top:14px", text:
      "These stay on this device. They're never synced anywhere — the backup service can't hold its own key." }),
  );

  const go2 = el("button.btn.primary.big.block", { onclick: async () => {
    const ep = epIn.value.trim().replace(/\/+$/, ""), tok = tokIn.value.trim();
    if (!/^https:\/\//i.test(ep)) { status.textContent = "The URL must start with https://"; return; }
    if (!tok) { status.textContent = "The token is needed too — it's what unlocks the backup."; return; }
    go2.disabled = true; status.textContent = "Connecting…";
    try {
      const db = await import("../db.js");
      const { setRuntimeConfig } = await import("../config.js");
      await setRuntimeConfig(db, { backup: { endpoint: ep, token: tok } });
      const { cloudPull } = await import("../cloudsync.js");
      const data = await cloudPull(8000);
      if (!data) {
        status.textContent = "Connected, but there's no backup stored there yet. Check the URL, or go back and set up fresh.";
        go2.disabled = false; return;
      }
      const { mergeRestore } = await import("../store.js");
      const added = await mergeRestore(data, { overwrite: true });
      status.textContent = `Restored ${added} session${added === 1 ? "" : "s"}. Reopening…`;
      // Full reload rather than routing on: boot re-runs the pull, the profile
      // migration and the routine resolution in the right order, against a store
      // that now has everything. Continuing in-place would leave stale in-memory
      // copies of exactly the things we just restored.
      setTimeout(() => { window.location.hash = "#/"; window.location.reload(); }, 700);
    } catch (e) {
      status.textContent = "Couldn't reach that backup: " + (e && e.message ? e.message : "unknown error");
      go2.disabled = false;
    }
  } }, "Restore");
  addActionBar(go2);
}
const point = (t, s) => el("div", { style: "margin-top:14px" }, [
  el("div", { style: "font-weight:700;font-size:.92rem", text: t }),
  el("p.note", { style: "margin:4px 0 0", text: s }),
]);

// --- about you ---------------------------------------------------------------
function about(body) {
  const seg = (opts, get, set) => {
    const row = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:8px" });
    const paint = () => row.replaceChildren(...opts.map(([val, label]) =>
      el("button.progchip" + (get() === val ? ".on" : ""), { onclick: () => { set(val); paint(); } }, label)));
    paint();
    return row;
  };
  const yearIn = el("input", { type: "text", inputmode: "numeric", placeholder: "e.g. 1985",
    value: S.birthYear ? String(S.birthYear) : "",
    style: "width:100%;padding:11px 13px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:11px;color:var(--text);font-size:.95rem" });

  body.append(
    el("h1", { style: "margin:4px 0 0", text: "About you" }),
    el("p.dim", { text: "Three answers. Each one changes what the app can do — nothing here is for a profile page." }),

    el("div.card", { style: "margin-top:18px" }, [
      el("div.label", { text: "Units" }),
      el("p.note", { style: "margin-top:4px", text: "Weights, distances and measurements throughout." }),
      seg([["kg", "Kilograms"], ["lb", "Pounds"]], () => S.units.weight, (v) => {
        S.units.weight = v;
        // Keep the whole system consistent — nobody wants lb with km.
        S.units.length = v === "lb" ? "in" : "cm";
        S.units.distance = v === "lb" ? "mi" : "km";
      }),
    ]),

    el("div.card", { style: "margin-top:12px" }, [
      el("div.label", { text: "Sex" }),
      el("p.note", { style: "margin-top:4px", text:
        "Used for one thing only: which bodyweight-relative strength standards you're compared against. Skip it and that card simply doesn't appear." }),
      seg([["male", "Male"], ["female", "Female"], [null, "Rather not say"]], () => S.sex, (v) => { S.sex = v; }),
    ]),

    el("div.card", { style: "margin-top:12px" }, [
      el("div.label", { text: "Year of birth" }),
      el("p.note", { style: "margin-top:4px", text:
        "The only input to your estimated max heart rate, which sets every cardio zone. If you know your real max, you can enter it in Settings instead." }),
      el("div", { style: "margin-top:10px" }, [yearIn]),
    ]),
  );
  bar("Continue", () => {
    const y = parseInt(yearIn.value, 10);
    const thisYear = new Date(todayISO() + "T00:00:00").getFullYear();
    S.birthYear = Number.isFinite(y) && y > thisYear - 100 && y < thisYear - 9 ? y : null;
    next();
  });
}

// --- what to track -----------------------------------------------------------
// Defaults are deliberately sparse. An app that opens with eight tracking cards
// lit up implies you should be filling all of them, which is how people end up
// logging nothing.
function track(body) {
  const OPTS = TRACKED_FEATURES;          // shared with Settings, so they can't drift
  const list = el("div.list", { style: "margin-top:16px" });
  const paint = () => list.replaceChildren(...OPTS.map(([key, title, sub]) => {
    const on = !!S.features[key];
    return el("button.item" + (on ? ".on" : ""), {
      style: "text-align:left" + (on ? ";border-color:var(--accent)" : ""),
      onclick: () => { S.features[key] = !on; paint(); },
    }, [
      el("div.meta", {}, [el("div.t", { text: title }), el("div.s", { text: sub })]),
      el("span.badge" + (on ? ".accent" : ""), { text: on ? "On" : "Off" }),
    ]);
  }));
  paint();
  body.append(
    el("h1", { style: "margin:4px 0 0", text: "What do you want to track?" }),
    el("p.dim", { text: "Only what you turn on appears in the app. You can change any of this later, and turning something on later doesn't lose anything." }),
    list,
  );
  bar("Continue", next);
}

// --- tracker -----------------------------------------------------------------
function tracker(body) {
  const list = el("div.list", { style: "margin-top:16px" });
  const paint = () => setChildren(list, ...PROVIDERS.map((p) => {
    const on = S.tracker === p.id;
    return el("button.item" + (on ? ".on" : ""), {
      style: "text-align:left" + (on ? ";border-color:var(--accent)" : ""),
      onclick: () => { S.tracker = p.id; paint(); },
    }, [
      el("div.meta", {}, [el("div.t", { text: p.label }), el("div.s", { text: p.blurb })]),
      on ? el("span.badge.accent", { text: "✓" }) : null,
    ].filter(Boolean));
  }));
  paint();
  body.append(
    el("h1", { style: "margin:4px 0 0", text: "Wearable?" }),
    el("p.dim", { text: "Optional, and it can be set up later. Without one you log runs and weigh-ins by hand — every other feature works exactly the same." }),
    list,
    el("p.note", { style: "margin-top:14px", text:
      "Both options need a little setup of your own (a WHOOP developer app, or an iPhone Shortcut). Settings walks you through it when you're ready." }),
  );
  bar("Continue", next);
}

// --- done --------------------------------------------------------------------
function done(body) {
  const themeRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:9px;margin-top:10px" });
  const paint = () => themeRow.replaceChildren(...THEMES.map((t) =>
    el("button", {
      style: `padding:8px 12px;border-radius:11px;cursor:pointer;background:${t.swatch[0]};`
        + `border:1.5px solid ${S.theme === t.id ? t.swatch[1] : "var(--line)"};color:#fff;font:700 .8rem system-ui`,
      onclick: () => { S.theme = t.id; applyTheme(t.id); paint(); },
    }, [
      el("span", { style: `display:inline-block;width:10px;height:10px;border-radius:99px;background:${t.swatch[1]};margin-right:7px` }),
      t.name,
    ])));
  paint();

  body.append(
    el("div", { style: "padding-top:22px" }, [
      el("h1", { style: "margin:0", text: "You're set" }),
      el("p.dim", { style: "margin-top:8px", text:
        "Next: build your first training block. A few questions about what you're training for and when you can train, and the app writes the plan." }),
    ]),
    el("div.card", { style: "margin-top:20px" }, [
      el("div.label", { text: "Pick a look" }),
      el("p.note", { style: "margin-top:4px", text: "Chart colours stay the same in all of them — only the surfaces and accent change." }),
      themeRow,
    ]),
  );
  bar("Build my first block", save, el("button.btn.big.block", { onclick: () => save("#/") }, "Later"));
}

async function save(dest) {
  await patchProfile({
    units: S.units,
    sex: S.sex,
    birthYear: S.birthYear,
    features: S.features,
    tracker: { provider: S.tracker },
    theme: S.theme,
    onboardedAt: todayISO(),
  });
  resetProviderCache();
  applyTheme(S.theme);
  const target = typeof dest === "string" ? dest : "#/build";
  S = null;                                   // don't keep stale answers around
  go(target);
}
