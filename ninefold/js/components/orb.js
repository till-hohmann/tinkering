// orb.js — the living readiness orb: a breathing sphere of flowing plasma (CSS
// conic gradient) wrapped by a glowing gradient progress ring (SVG), with a huge
// Sora numeral at its heart. The signature hero of the Today screen. The ring
// animates its fill on mount; the plasma + breathe loop run from CSS.

import { auroraStops } from "../theme.js";
import { el } from "../ui.js";

const NS = "http://www.w3.org/2000/svg";
const CIRC = 2 * Math.PI * 52;            // ring circumference (r = 52 in a 120 viewBox)
let uidc = 0;

// opts: { pct 0-100, value, unit, label } — returns the .orbwrap element.
export function orbEl({ pct = 0, value = "", unit = "", label = "" } = {}) {
  // Resolved per render, NOT at module load: modules are imported before boot
  // applies the theme, so a load-time read would bake the default palette in and
  // the orb would ignore every theme switch.
  const S = auroraStops();
  const u = "orb" + uidc++;
  const off = CIRC * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "orbring");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.innerHTML =
    `<defs>` +
    `<linearGradient id="${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${S[0]}"/><stop offset=".5" stop-color="${S[1]}"/><stop offset="1" stop-color="${S[2]}"/></linearGradient>` +
    `<filter id="${u}g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `</defs>` +
    `<circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="7"/>` +
    `<circle class="orbarc" cx="60" cy="60" r="52" fill="none" stroke="url(#${u})" stroke-width="7" stroke-linecap="round" transform="rotate(-90 60 60)" filter="url(#${u}g)" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${CIRC.toFixed(1)}"/>`;

  const num = el("div.onum", {}, [
    el("b", {}, [el("span", { text: String(value) }), unit ? el("i", { text: unit }) : null]),
    label ? el("em", { text: label }) : null,
  ]);
  const wrap = el("div.orbwrap", {}, [svg, el("div.orb"), num]);

  // animate the ring fill on mount (skipped under reduced-motion via CSS contract)
  requestAnimationFrame(() => {
    const arc = svg.querySelector(".orbarc");
    if (arc) { arc.style.transition = "stroke-dashoffset 1.15s cubic-bezier(.2,.8,.2,1)"; arc.style.strokeDashoffset = off.toFixed(1); }
  });
  return wrap;
}
