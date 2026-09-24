// check.mjs — static verification for a buildless ES-module app.
//
//   node tools/check.mjs
//
// There is no bundler here to catch a typo'd import, and the dev preview pins
// modules in memory so a broken import can survive a manual click-through. This
// walks every module, resolves every relative import against the target file's
// real export list, and fails loudly on a mismatch. It is the cheapest possible
// stand-in for a type checker.
//
// It is deliberately static (regex over source) rather than dynamic (import()):
// half these modules touch indexedDB, WebAudio or the DOM at module scope, so
// actually loading them under node would fail for reasons that have nothing to
// do with correctness.

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const JS = join(ROOT, "js");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

// --- export extraction -------------------------------------------------------
// Handles the forms this codebase actually uses:
//   export function f(), export async function f(), export const a = , export let
//   export const {a, b} = ..., export class C
//   export { a, b as c }
//   export default
const EXPORT_PATTERNS = [
  /^\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
];

function exportsOf(src) {
  const names = new Set();
  for (const re of EXPORT_PATTERNS) {
    for (const m of src.matchAll(re)) names.add(m[1]);
  }
  // export const { a, b } = ...  /  export const [a, b] = ...
  for (const m of src.matchAll(/^\s*export\s+(?:const|let|var)\s*[{[]([^}\]]+)[}\]]\s*=/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.split(":").pop().trim().replace(/^\.\.\./, "");
      if (name) names.add(name);
    }
  }
  // export { a, b as c }
  for (const m of src.matchAll(/^\s*export\s*{([^}]*)}\s*(?!from)/gm)) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      names.add(seg.includes(" as ") ? seg.split(" as ").pop().trim() : seg);
    }
  }
  if (/^\s*export\s+default\b/m.test(src)) names.add("default");
  // export * from "./x.js" — record so the checker can widen rather than warn
  const stars = [...src.matchAll(/^\s*export\s*\*\s*from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
  return { names, stars };
}

// --- import extraction -------------------------------------------------------
function importsOf(src) {
  const out = [];
  // static: import ... from "..."
  for (const m of src.matchAll(/^\s*import\s+([^"';]+?)\s*from\s*["']([^"']+)["']/gm)) {
    out.push({ clause: m[1], spec: m[2], dynamic: false });
  }
  // dynamic: await import("...") — used for the lazy profile/store cycle breaks
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push({ clause: null, spec: m[1], dynamic: true });
  }
  return out;
}

function namedFromClause(clause) {
  if (!clause) return [];
  const braced = clause.match(/{([^}]*)}/);
  if (!braced) return [];
  return braced[1].split(",").map((s) => s.trim().split(" as ")[0].trim()).filter(Boolean);
}

// --- run ---------------------------------------------------------------------
const files = walk(JS);
const srcOf = new Map();
const expOf = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  srcOf.set(f, src);
  expOf.set(f, exportsOf(src));
}

// Resolve `export *` chains so a re-exporting barrel doesn't produce false errors.
function allExports(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const rec = expOf.get(file);
  if (!rec) return new Set();
  const names = new Set(rec.names);
  for (const spec of rec.stars) {
    const target = resolve(dirname(file), spec);
    for (const n of allExports(target, seen)) names.add(n);
  }
  return names;
}

const errors = [];
const dynamicNamed = [];

for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  for (const imp of importsOf(srcOf.get(f))) {
    if (!imp.spec.startsWith(".")) continue;                 // bare specifier: none here
    const target = resolve(dirname(f), imp.spec.split("?")[0]);
    if (!existsSync(target)) {
      errors.push(`${rel}: imports "${imp.spec}" which does not exist`);
      continue;
    }
    if (imp.dynamic) { dynamicNamed.push({ rel, spec: imp.spec }); continue; }
    const available = allExports(target);
    for (const name of namedFromClause(imp.clause)) {
      if (!available.has(name)) {
        errors.push(`${rel}: imports { ${name} } from "${imp.spec}" — not exported there`);
      }
    }
  }
}

// --- module-aware syntax check ----------------------------------------------
// `node --check foo.js` parses as a CommonJS SCRIPT, where `await` inside a
// non-async function is not always flagged the way it is in a module. That let a
// real "Unexpected reserved word" reach the browser once — an `await` inside a
// Promise executor, which node --check accepted and the browser refused to
// parse. Copying to a .mjs forces true module parsing, which catches it.
const tmp = mkdtempSync(join(tmpdir(), "ninefold-check-"));
try {
  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    const target = join(tmp, basename(f).replace(/\.js$/, "") + ".mjs");
    writeFileSync(target, srcOf.get(f));
    const r = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    if (r.status !== 0) {
      const msg = (r.stderr || "").split("\n").filter((l) => /SyntaxError|\^/.test(l)).slice(0, 2).join(" ").trim();
      errors.push(`${rel}: ${msg || "failed to parse as an ES module"}`);
    }
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

// --- report ------------------------------------------------------------------
console.log(`checked ${files.length} modules`);
if (dynamicNamed.length) {
  console.log(`${dynamicNamed.length} dynamic import(s) (existence verified, names not statically checkable)`);
}
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log("all imports resolve");
