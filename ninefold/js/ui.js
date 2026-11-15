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

/**
 * Escape text for an HTML template. Anything that came from OUTSIDE the app — a
 * Shortcut's field names, a tracker's workout type, a value in an imported file —
 * goes through this before it reaches innerHTML, or a crafted payload runs as
 * script in the app's origin, where the backup token lives.
 */
export const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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

/**
 * HOW YOU GOT HERE DECIDES HOW THE SCREEN ARRIVES.
 *
 * Every screen change used to play the same 300 ms rise and jump to the top,
 * whether you had switched tab, opened a day or come back from one. So going
 * back looked like going forward, and a list you had scrolled lost its place.
 *
 *   tab      switching between the bottom tabs — instant, as a tab bar is
 *   forward  opening something — slides in from the right
 *   back     returning — slides in from the left, at the scroll you left it at
 *   inner    a screen redrawing itself (a wizard step, a new phase) — the rise
 *
 * The router calls noteNavigation() before it runs a route; the next mount()
 * reads the answer. A back navigation is recognised by its destination being
 * the screen before this one, so the in-app back buttons, which navigate
 * rather than pop history, count as well as the system gesture.
 */
const navStack = [];
const scrollMemo = new Map();
let navKind = "none";
let restoreScroll = null;      // { y, until } — outlives one mount, for views that mount twice
let lastHadTabs = false;
try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch {}

export function noteNavigation(hash, hasTabs) {
  const prev = navStack[navStack.length - 1];
  if (prev != null) scrollMemo.set(prev, window.scrollY);
  restoreScroll = null;
  if (prev == null) { navStack.push(hash); navKind = "none"; }
  else if (prev === hash) navKind = "inner";
  else if (navStack[navStack.length - 2] === hash || (backTapped && sameSection(navStack[navStack.length - 2], hash))) {
    // The back button names the parent screen, which is not always spelled the
    // way you arrived at it ("#/week" on the way in, "#/week/<block>/1" on the
    // way out). Same section, so it is the screen you left: use its scroll.
    const from = navStack[navStack.length - 2];
    navStack.pop();
    navStack[navStack.length - 1] = hash;
    navKind = "back";
    restoreScroll = { y: scrollMemo.get(from) || 0, until: performance.now() + 1500 };
  } else if (backTapped) {
    navStack.length = 0; navStack.push(hash);
    navKind = "back";
  } else if (hasTabs && lastHadTabs && TABS.some(([, , href]) => href === hash)) {
    // One tab to another: a fresh stack, nothing to go back to.
    navStack.length = 0; navStack.push(hash);
    navKind = "tab";
  } else {
    navStack.push(hash);
    if (navStack.length > 30) navStack.shift();
    navKind = "forward";
  }
  lastHadTabs = !!hasTabs;
  backTapped = false;
}
let backTapped = false;
const sameSection = (a, b) => !!a && a.split("/")[1] === b.split("/")[1];

// A screen redrawing itself after one of its own controls changed (a settings
// toggle, a range, a section tab) should simply change, not arrive again.
export function quietNextMount() { navKind = "none"; }

const ENTER = {
  forward: [[{ opacity: 0, transform: "translateX(18px)" }, { opacity: 1, transform: "none" }], 240],
  back: [[{ opacity: 0, transform: "translateX(-18px)" }, { opacity: 1, transform: "none" }], 200],
  inner: [[{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], 220],
};

export function mount(children) {
  runCleanups();
  const view = document.getElementById("view");
  clear(view);
  document.querySelectorAll(".actionbar, .resttimer, canvas.confetti").forEach((n) => n.remove());
  document.body.classList.remove("has-actionbar");
  appendChildren(view, children);
  const kind = navKind;
  navKind = "inner";
  const keep = restoreScroll && performance.now() < restoreScroll.until ? restoreScroll.y : 0;
  window.scrollTo(0, keep);
  // view-enter motion. With reduced motion on, the change is still shown, as a
  // short fade in place: no slide, nothing travelling across the screen.
  const enter = ENTER[kind];
  if (enter && view.animate) {
    try {
      if (reduceMotion()) view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
      else view.animate(enter[0], { duration: enter[1], easing: "cubic-bezier(.2,.75,.25,1)" });
    } catch {}
  }
  return view;
}

/**
 * Put a bottom sheet on screen: it slides up over a fading backdrop, slides
 * back down when it closes, and can be pulled down by its grip.
 *
 * Sheets used to appear with a 14 px nudge and vanish on close, and the grip
 * at the top was drawn but did nothing. Call this where the sheet was
 * appended to the body. Closing is still `ov.remove()` at every call site;
 * the sheet's own remove is replaced here so each of them gets the exit.
 * Pulling the grip past the threshold acts as a tap on the backdrop, so the
 * sheet resolves exactly as that site's dismissal already does.
 */
export function presentSheet(ov) {
  const card = ov.querySelector(".sheet-card");
  document.body.appendChild(ov);
  void ov.offsetWidth;
  ov.classList.add("in");
  let gone = false;
  ov.remove = () => {
    if (gone) return;
    gone = true;
    ov.classList.remove("in");
    ov.style.pointerEvents = "none";
    setTimeout(() => Element.prototype.remove.call(ov), reduceMotion() ? 180 : 260);
  };
  const grip = card && card.querySelector(".sheet-grip");
  if (!grip) return ov;
  // THE DRAG BEHAVES LIKE A THING YOU ARE HOLDING.
  //  - It is grabbed where it is: catching a sheet that is still sliding in
  //    starts from its live position, not from where it was heading.
  //  - Pulling up past the top resists more the further you pull, instead of
  //    stopping dead.
  //  - On release it goes where the flick was taking it: the finger's speed
  //    projects a resting point, and the sheet closes if that point is past
  //    half its height. A short fast flick closes it; a slow long pull that
  //    stops short does not.
  //  - Closing continues at the finger's speed, so letting go has no seam.
  let startY = 0, base = 0, y = 0, dragging = false, samples = [];
  const rubber = (over, dim) => (over * dim * 0.55) / (dim + 0.55 * Math.abs(over));
  const live = () => { try { return new DOMMatrix(getComputedStyle(card).transform).m42 || 0; } catch { return 0; } };
  const velocity = () => {
    // px per second over the last ~100 ms of movement
    const now = performance.now();
    const recent = samples.filter((p) => now - p.t < 100);
    if (recent.length < 2) return 0;
    const a = recent[0], b = recent[recent.length - 1];
    return ((b.y - a.y) / Math.max(1, b.t - a.t)) * 1000;
  };
  const project = (v, d = 0.998) => (v / 1000) * d / (1 - d);
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    // Commit the dragged position as the starting point before handing over to
    // a transition, or the browser can start the settle from a stale frame.
    void getComputedStyle(card).transform;
    const v = velocity(), h = card.offsetHeight || 1;
    const dismiss = e.type !== "pointercancel" && y + project(Math.max(0, v)) > h * 0.5 && y > 4;
    if (dismiss && !reduceMotion()) {
      // keep the finger's speed: the time to cover what is left at that speed,
      // within reason, decelerating into the bottom edge
      const left = Math.max(0, h - y);
      const ms = Math.round(Math.min(280, Math.max(140, v > 0 ? (left / v) * 1000 * 1.6 : 260)));
      card.style.transition = `transform ${ms}ms cubic-bezier(.2,.6,.35,1)`;
    } else {
      card.style.transition = "";      // back to the stylesheet's settle curve, from where it is now
    }
    card.style.transform = "";
    if (dismiss) {
      ov.dispatchEvent(new MouseEvent("click"));       // same path as a tap on the backdrop
      if (!gone) ov.remove();
    }
    samples = []; y = 0;
  };
  grip.addEventListener("pointerdown", (e) => {
    if (dragging || gone) return;      // a second finger must not restart the drag
    dragging = true; startY = e.clientY;
    base = live(); y = base;
    card.style.transition = "none";
    card.style.transform = `translateY(${base}px)`;
    samples = [{ y: e.clientY, t: performance.now() }];
    try { grip.setPointerCapture(e.pointerId); } catch {}
  });
  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const raw = base + e.clientY - startY;
    y = raw >= 0 ? raw : -rubber(-raw, card.offsetHeight || 1);
    card.style.transform = `translateY(${y}px)`;
    samples.push({ y: e.clientY, t: performance.now() });
    if (samples.length > 8) samples.shift();
  });
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  return ov;
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

/**
 * One toast, at the top, one message at a time.
 *
 * There were four copies of this, each appending its own pill above the bottom
 * edge — exactly where the rest timer sits, so logging a set that also set a
 * record hid the countdown and its −15 / +15 / Skip for two seconds, and two
 * messages from one tap landed on top of each other. Messages now queue.
 */
const toastQueue = [];
let toastBusy = false;
export function toast(msg, ms = 2200) {
  toastQueue.push([String(msg), ms]);
  if (!toastBusy) nextToast();
}
function nextToast() {
  const item = toastQueue.shift();
  if (!item) { toastBusy = false; return; }
  toastBusy = true;
  const [msg, ms] = item;
  const t = el("div.toast", { role: "status", text: msg });
  document.body.appendChild(t);
  void t.offsetWidth;                 // commit the start state so the entrance transitions
  t.classList.add("in");
  // A message with others waiting behind it gives way sooner.
  const stay = toastQueue.length ? Math.min(ms, 1500) : ms;
  setTimeout(() => {
    t.classList.remove("in");
    setTimeout(() => { t.remove(); nextToast(); }, 200);
  }, stay);
}

/**
 * Press and hold a stepper to keep stepping.
 *
 * A single tap is still the button's own click. Holding for 400 ms starts a
 * repeat every 80 ms and swallows the click that follows the release, so a hold
 * never counts one extra. A finger that starts a scroll on the button cancels
 * the pointer, and nothing fires.
 */
export function holdRepeat(btn, fn) {
  let wait = null, rep = null, held = false;
  const stop = () => { clearTimeout(wait); clearInterval(rep); wait = rep = null; };
  btn.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    stop(); held = false;
    wait = setTimeout(() => { held = true; fn(); rep = setInterval(fn, 80); }, 400);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) btn.addEventListener(ev, stop);
  btn.addEventListener("click", (e) => { if (held) { held = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());   // long-press menu on Android
  return btn;
}

// Clean, native-feeling back affordance: a chevron + label, no boxy border.
export function backBtn(label, href = "#/") {
  return el("button.backbtn", { onclick: () => { backTapped = true; go(href); }, "aria-label": "Back to " + label }, [
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
/**
 * The wrapper the overviews draw a superset in: a labelled rail around the
 * exercises that alternate, so a paired day is visible before it starts rather
 * than at the moment the session hands you a different lift.
 */
export function supersetGroup(label, rows, { note = "Alternate · rest after the round" } = {}) {
  return el("div.ssgroup", {}, [
    el("div.sshead", {}, [el("span.ssname", { text: label }), el("span.spacer"), el("span.ssnote", { text: note })]),
    ...rows,
  ]);
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
