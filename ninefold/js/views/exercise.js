// exercise.js — the exercise anatomy card (#/exercise/:id). Shows the photoreal
// activation render when one has shipped, the SVG poster figure when it hasn't,
// and — either way — the muscle callouts and the front/back body map, all driven
// by js/exercise-anatomy.js so the picture and the words can never disagree.
//
// Labels are drawn HERE rather than baked into the render: they stay readable at
// phone size, match the app's type, and a muscle attribution can be corrected
// without regenerating a 1024px image.

import { el, mount, go } from "../ui.js";
import { illustration } from "../illustrations.js";
import { muscleBody } from "../anatomy.js";
import { anatomyFor, heatByGroup, ROLES } from "../exercise-anatomy.js";
import { loadPhotoManifest, photoURL } from "../exercise-photo.js";
import { getActiveProgram } from "../store.js";
import { MOBILITY_SESSIONS } from "../mobility.js";

// role → the heat-map colour it corresponds to in the render, so the callout
// chip reads as a key to the image.
// Matched to the RENDERS, not chosen freely. The shipped images shade the primary
// mover RED and everything secondary AMBER, so the callout dots have to speak the
// same language: the previous palette made "primary" yellow, which is the render's
// colour for secondary — the list and the picture beside it contradicted each other.
// Stabilizers get a cool tone precisely BECAUSE the renders don't shade them; a
// third warm colour would imply a heat level the image doesn't show.
const ROLE_COLOR = {
  primary: "#f87171",     // red — the render's hot muscle
  synergist: "#fbbf24",   // amber — the render's warm muscle
  stabilizer: "#7dd3fc",  // cool: named here, deliberately not lit in the render
};

// Lifts live in the program library; the M&S movements are an app-side constant
// (js/mobility.js), so both have to be searched before falling back to the id.
function exerciseName(programs, id) {
  for (const p of programs || []) {
    const ex = p && p.exercises && p.exercises[id];
    if (ex && ex.name) return ex.name;
  }
  for (const wd in MOBILITY_SESSIONS) {
    const hit = (MOBILITY_SESSIONS[wd].items || []).find((i) => i.id === id);
    if (hit && hit.name) return hit.name;
  }
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function renderExercise(id) {
  const [manifest, program] = await Promise.all([loadPhotoManifest(), getActiveProgram()]);
  void manifest;
  const name = exerciseName(program ? [program] : [], id);
  const muscles = anatomyFor(id);
  const url = photoURL(id);

  // --- hero: the render, or the poster figure as the standing fallback -------
  const hero = el("div.exhero" + (url ? ".photo" : ""));
  if (url) {
    const img = el("img", { src: url, alt: `${name} — muscles worked`, loading: "eager", decoding: "async" });
    // a render that 404s (manifest out of step with disk) must not leave a hole
    img.onerror = () => { hero.classList.remove("photo"); hero.replaceChildren(illustration(id)); };
    hero.appendChild(img);
  } else {
    hero.appendChild(illustration(id));
  }

  // reached as a drill-down from wherever the exercise was tapped, so step back
  // through history rather than guessing a parent screen
  const back = el("button.backbtn", {
    onclick: () => { if (history.length > 1) history.back(); else go("#/"); },
    "aria-label": "Back",
  }, [el("span.chev", { html: "‹" }), el("span", { text: "Back" })]);

  const children = [back, el("h1", { text: name }), hero];

  // --- callouts: the reference image's labels, drawn by the app -------------
  if (muscles) {
    children.push(el("div.card.excallouts", { style: "margin-top:14px" }, [
      el("div.label", { text: "Muscles worked" }),
      el("ul.calloutlist", {}, muscles.map((mu) =>
        el("li.callout", {}, [
          el("span.cdot", { style: `background:${ROLE_COLOR[mu.role]}` }),
          el("span.cname", { text: mu.label.toUpperCase() }),
          el("span.crole", { style: `color:${ROLE_COLOR[mu.role]}`, text: `(${ROLES[mu.role].label.toLowerCase()})` }),
        ]))),
    ]));

    // --- body map: the same attribution, shaded by role ---------------------
    // ONLY when there's no render. The shipped images carry their own front/back
    // activation figures in the right-hand panel, so drawing the app's version
    // underneath states the same thing twice — and the SVG map loses badly to a
    // photoreal one sitting two centimetres above it. Without a render it is the
    // only activation view there is, so it stays.
    const heat = heatByGroup(id);
    const colorOf = (group) => {
      const h = heat[group];
      if (!h) return null;
      if (h >= 1) return ROLE_COLOR.primary;
      if (h >= 0.6) return ROLE_COLOR.synergist;
      return ROLE_COLOR.stabilizer;
    };
    if (!url) children.push(el("div.card", { style: "margin-top:14px" }, [
      el("div.label", { text: "Activation map" }),
      muscleBody(colorOf, { glow: true }),
    ]));
  } else {
    children.push(el("div.card", { style: "margin-top:14px" }, [
      el("p.dim", { style: "margin:0", text: "No muscle attribution recorded for this movement yet." }),
    ]));
  }

  return mount(children);
}
