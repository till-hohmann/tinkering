// ui.js — minimal DOM helpers. Keeps views declarative without a framework.

// el("div.card#id", {onclick}, [children]) — tag supports .class and #id shorthand.
export function el(spec, attrs = {}, children = []) {
  const m = spec.match(/^([a-z0-9]+)?(#[\w-]+)?((?:\.[\w-]+)*)$/i);
  const tag = (m && m[1]) || "div";
  const node = document.createElement(tag);
  if (m && m[2]) node.id = m[2].slice(1);
  if (m && m[3]) node.className = m[3].split(".").filter(Boolean).join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = (node.className ? node.className + " " : "") + v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k in node && k !== "list") { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/**
 * Replace a node's children, SKIPPING null and false the way el() does.
 *
 * Use this instead of node.replaceChildren(). The native method stringifies
 * whatever it is given, so the ordinary conditional-child idiom
 *
 *     card.replaceChildren(title, body, showFooter ? footer : null)
 *
 * prints the literal word "null" on screen the moment the condition is false —
 * which is exactly what happened on the yoga picker, and is latent at ten other
 * call sites that were written the same way. el() has always filtered; the
 * imperative path had no equivalent, so this is it.
 */
export function setChildren(node, ...children) {
  clear(node);
  appendChildren(node, children);
  return node;
}

// Cleanup registry — views/components register teardown (stop tickers, release
// wake locks) so navigating away mid-session never leaks an animation loop.
let _cleanups = [];
export function registerCleanup(fn) { _cleanups.push(fn); }
function runCleanups() {
  const c = _cleanups; _cleanups = [];
  c.forEach((fn) => { try { fn(); } catch {} });
}

const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function mount(children) {
  runCleanups();
  const view = document.getElementById("view");
  clear(view);
  document.querySelectorAll(".actionbar, .resttimer, canvas").forEach((n) => n.remove());
  document.body.classList.remove("has-actionbar");
  appendChildren(view, children);
  window.scrollTo(0, 0);
  // view-enter motion (skipped under reduced-motion / no WAAPI)
  if (!reduceMotion() && view.animate) {
    try {
      view.animate(
        [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
        { duration: 300, easing: "cubic-bezier(.2,.75,.25,1)" }
      );
    } catch {}
  }
  return view;
}

// Count a number up to its target on mount. fmt(value)->string. Respects reduced motion.
export function countUp(node, to, { dur = 650, fmt = (v) => String(Math.round(v)), from = 0 } = {}) {
  if (!node) return;
  if (reduceMotion() || typeof requestAnimationFrame !== "function") { node.textContent = fmt(to); return; }
  // Safety net: guarantee the final value even if rAF is throttled and never runs.
  const safety = setTimeout(() => { node.textContent = fmt(to); }, dur + 200);
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = fmt(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else clearTimeout(safety);
  };
  requestAnimationFrame(step);
}

// Sticky bottom CTA bar. Cleared automatically on next mount().
export function addActionBar(...btns) {
  const old = document.querySelector(".actionbar");
  if (old) old.remove();
  const bar = el("div.actionbar", {}, [el("div.inner", {}, btns)]);
  document.body.appendChild(bar);
  // Tells the stylesheet to lift the bar clear of the tab bar and to give the
  // view enough bottom padding that the last card isn't hidden behind both.
  document.body.classList.add("has-actionbar");
  return bar;
}

export function go(hash) { window.location.hash = hash; }

// Light haptic where the platform allows (never depended on — §6).
export function haptic(ms = 12) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}

// Clean, native-feeling back affordance: a chevron + label, no boxy border.
export function backBtn(label, href = "#/") {
  return el("button.backbtn", { onclick: () => go(href), "aria-label": "Back to " + label }, [
    el("span.chev", { html: "‹" }), el("span", { text: label }),
  ]);
}

// Place badge. Places are user-named free text, so the colour can't be keyed off
// a literal name any more — it's derived from the name itself, which gives every
// place a stable colour without anyone having to choose one. Same name always
// lands on the same hue, and it never collides with the semantic data palette
// (strength / cardio / recovery / intensity) because it only tints a chip.
const PLACE_TINTS = ["hue-amber", "hue-blue", "hue-violet", "hue-teal", "hue-rose", "hue-lime"];
function placeTint(name) {
  if (!name) return "";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return "." + PLACE_TINTS[h % PLACE_TINTS.length];
}
export const locationBadge = (loc) => el("span.badge" + placeTint(loc), { text: loc || "—" });

// --- Persistent bottom tab bar -------------------------------------------
const TAB_ICONS = {
  today: "M4 11l8-7 8 7M6 9.5V19h12V9.5M10 19v-5h4v5",
  plan: "M4 8h16v12H4zM4 8V5h16v3M8 3v4M16 3v4M8 12h8M8 16h5",
  // ॐ, in the six strokes the glyph is actually made of:
  //   1. the upper curl — the top bowl of the "3"
  //   2. the long lower sweep, open to the RIGHT (a crescent, not a closed bowl)
  //   3. the wave leaving the waist to the right
  //   4. the large CLOSED loop on the right
  //   5. the crescent (chandra), opening upward, above the loop
  //   6. the bindu — a zero-length round-capped segment; a dot needs no arc
  //
  // ⚠ STROKE 4 IS THE ONE THE FIRST ATTEMPT GOT WRONG. It drew a small hook off
  // to the right, which is not what ॐ looks like: the right-hand loop is a big
  // closed oval, roughly the same visual mass as the lower sweep, and getting it
  // small turns the whole character into something else.
  //
  // DRAWN, NOT SET IN A FONT. The character needs a Devanagari face installed,
  // and where one exists it arrives at whatever weight that font chose — beside
  // five 2px stroke icons that reads as a paste-in. Built against the real glyph
  // rasterised from the system font and checked at the size it renders: 22% ink
  // against 23% for both Today and Progress.
  yoga: "M5.8 9.6 C6.2 7.5 10.6 7.1 11.6 9.3 C12.2 10.5 11.0 11.3 10.0 11.8 " +
        "C6.5 12.2 2.2 14.3 1.9 17.7 C1.6 20.8 4.3 22.6 7.2 22.4 C10.1 22.2 12.2 20.3 12.1 17.9 " +
        "M10.0 11.8 C12.0 12.0 13.4 12.4 15.4 13.0 " +
        "M18.7 11.6 C21.2 11.6 22.6 13.9 22.6 16.8 C22.6 19.8 21.0 21.8 18.7 21.8 " +
        "C16.3 21.8 14.8 19.8 14.8 16.8 C14.8 13.9 16.2 11.6 18.7 11.6 Z " +
        "M13.7 4.6 C14.8 7.6 20.0 7.6 21.1 4.6 M17.4 2.2 L17.45 2.2",
  progress: "M4 20V4M4 20h16M8 20v-7M13 20V8M18 20v-10",
  body: "M4 8h16M4 8v8M4 16h16M20 8v8M8 8v3M12 8v4M16 8v3",   // tape measure = body composition
  profile: "M12 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5 20a7 7 0 0114 0",
};
const TABS = [
  ["today", "Today", "#/"],
  ["plan", "Plan", "#/week"],
  ["yoga", "Yoga", "#/yoga"],
  ["progress", "Progress", "#/progress"],
  ["body", "Body", "#/body"],
  ["profile", "Profile", "#/settings"],
];

function tabIcon(id) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "line tico");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", TAB_ICONS[id]);
  svg.appendChild(p);
  return svg;
}

// Tabs the profile has switched off. Set once at boot and again when Settings
// changes an answer, so a feature nobody wants doesn't take a sixth of the bar.
// Kept here rather than read from the profile inside showTabs because showTabs is
// called synchronously on every route change and the profile read is async.
let hiddenTabs = new Set();
export function setHiddenTabs(keys) {
  hiddenTabs = new Set(keys || []);
  const bar = document.querySelector(".tabbar");
  if (bar) bar.remove();          // rebuilt on the next showTabs with the new set
}
export const isTabHidden = (key) => hiddenTabs.has(key);

// Show (or update the active state of) the persistent tab bar.
export function showTabs(activeKey) {
  let bar = document.querySelector(".tabbar");
  const visible = TABS.filter(([key]) => !hiddenTabs.has(key));
  if (!bar) {
    bar = el("div.tabbar", {}, [el("div.tabinner", {}, visible.map(([key, label, href]) =>
      el("button.tab", { onclick: () => go(href), "aria-label": label }, [
        tabIcon(key), el("span.tlabel", { text: label }),
      ])))]);
    document.body.appendChild(bar);
  }
  document.body.classList.add("has-tabs");
  // Publish the bar's REAL height so the sticky CTA and the view's bottom padding
  // sit exactly on top of it rather than on an assumption about it.
  //
  // Measured SYNCHRONOUSLY, not in requestAnimationFrame. rAF does not run in a
  // backgrounded tab, so the deferred version silently left the fallback in place
  // — which is the whole class of bug this is fixing. Reading offsetHeight forces
  // one layout; that is a fair price for a number that is always right.
  const h = bar.offsetHeight;
  if (h) document.documentElement.style.setProperty("--tabbar-h", h + "px");
  bar.querySelectorAll(".tab").forEach((t, i) => t.classList.toggle("active", visible[i] && visible[i][0] === activeKey));
}

export function hideTabs() {
  const bar = document.querySelector(".tabbar");
  if (bar) bar.remove();
  document.body.classList.remove("has-tabs");
  // ZERO, not "unset". Removing the property let it fall back to the 64px default,
  // so every full-screen flow reserved bottom padding for a tab bar that is not
  // there — 64px of dead space on exactly the screens that need it most. The
  // guided practice player overflowed a small phone by almost precisely this.
  document.documentElement.style.setProperty("--tabbar-h", "0px");
}
