// build-public.mjs — assemble the PUBLIC release tree, and refuse to if anything
// personal is in it.
//
//   node tools/build-public.mjs <target-dir>
//
// This is the gate between a private development repo and a public one, so it
// FAILS CLOSED: an explicit allowlist of what may be copied (never a denylist of
// what may not — a denylist silently ships every new file you forget about),
// then a content scan over the assembled tree, then a hard exit on any hit.
//
// The threat isn't malice, it's drift: fourteen months of commits by someone who
// was the only user, where "my weight is 118 kg" was a perfectly reasonable
// thing to write in a constant. The scan encodes every category of that which
// has already been found and removed once, so it can't come back unnoticed.

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname, relative, resolve, extname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const TARGET = process.argv[2];
if (!TARGET) { console.error("usage: node tools/build-public.mjs <target-dir>"); process.exit(2); }

// --- what ships --------------------------------------------------------------
// Directories copied wholesale, and individual files. Anything not named here
// does not go public, including anything added later.
const DIRS = ["js", "css", "fonts", "audio", "icons", "img", "backup-worker/src", "whoop-worker/src"];
const FILES = [
  "index.html", "manifest.webmanifest", "sw.js",
  "backup-worker/wrangler.toml", "whoop-worker/wrangler.toml", "whoop-worker/README.md",
  "tools/check.mjs", "tools/test.mjs", "tools/build-public.mjs",
  "tools/deploy.ps1", "tools/make-icons.py", "tools/make-mark-nine.py", "tools/build-exercise-images.py",
  "tools/illustration-prompts.md",
  "docs/apple-health.md",
  "THIRD-PARTY.md",
];
// Files renamed on the way out: the dev repo keeps its own README, the public
// tree gets the one written for strangers.
const RENAMES = { "README.public.md": "README.md", "GETTING_STARTED.public.md": "GETTING_STARTED.md" };
// Never copied even from inside an allowed directory.
// `concepts` is design scratch — rejected icon directions, before/after sheets.
// Useful history in the dev repo, noise in a release someone is cloning.
//
// The exercise PNGs are MASTERS, not assets: ~1.9 MB each, 129 MB for the set,
// and the app never loads one — `build-exercise-images.py` turns them into the
// 1024px webps that actually ship. Copying them would put 136 MB into a git repo
// to deliver 5 MB of images. They are gitignored in the dev repo for the same
// reason, but this tool copies from DISK, so it needs its own rule.
const EXCLUDE_RE = /(^|[\\/])(\.wrangler|node_modules|__pycache__|\.deploy|overlay|concepts)([\\/]|$)|\.pyc$|(^|[\\/])img[\\/]exercises[\\/][^\\/]+\.png$/;

// --- what must never appear --------------------------------------------------
//
// NOTE ON WHAT IS DELIBERATELY *NOT* HERE. This file ships publicly, so it must
// not contain the literal secrets it defends against: writing a token here to
// forbid it publishes it, and even a prefix of a live one hands over the first
// characters of the secret. The first version of this file did exactly that, and
// it was caught by the final pre-publish scan — by this tool, on itself.
//
// So the public list holds only CATEGORIES, recognisable by shape or vocabulary
// and harmless to state out loud. Exact literals live in an optional private
// list loaded below, which never leaves the development machine.
// The rule this list follows, arrived at the hard way: PUBLIC PATTERNS ARE
// STRUCTURAL ONLY. Not one proper noun — no token, no hostname, no project name,
// no diagnosis, no city. Three separate times a draft of this file was itself
// the only thing the scan flagged, because forbidding a specific string means
// writing that string down, and this file ships. Shapes are safe to publish;
// names are not. Names go in the private list below.
const FORBIDDEN = [
  { re: /workers\.dev/i, why: "a Worker endpoint", allow: /your-|<you>|example/i },
  { re: /pages\.dev/i, why: "a Pages deployment", allow: /your-|<you>|example|\*\./i },
  // \b matters: without it, "diagnosed (from|with|in)" matches "diagnosed
  // INjury" and flags the app's own second-person disclaimer, which is exactly
  // the copy that should be there.
  { re: /(diagnosed (from|with|in)\b|rehab protocol|post-op|my (injur|knee|back|shoulder))/i, why: "first-person clinical language" },
  { re: /Bearer\s+[A-Za-z0-9_\-+/=]{16,}/, why: "a hardcoded bearer credential" },
  { re: /[A-Z]:\Users\|\/Users\/[a-z]/, why: "a local filesystem path" },
  // Shape-based catches for credentials nobody thought to list: a 32-hex id
  // (KV namespace, Cloudflare account) and a long base64-ish string literal.
  { re: /[0-9a-f]{32}/i, why: "a 32-hex id (KV namespace / account?)", allow: /PUT_YOUR/i },
  // Base64-ish secret, by ENTROPY rather than by shape alone. Long CamelCase API
  // constants defeat every purely structural version of this rule:
  // "HKQuantityTypeIdentifierRestingHeartRate" is 40 letters, and
  // "HKQuantityTypeIdentifierVO2Max" even carries a digit. What actually
  // separates a generated key is that its digits are SCATTERED — three or more,
  // mixed through both cases — where an identifier has at most one.
  { test: (line) => {
      for (const m of line.matchAll(/["']([A-Za-z0-9+/]{28,}={0,2})["']/g)) {
        const s = m[1];
        const digits = (s.match(/\d/g) || []).length;
        if (digits >= 3 && /[a-z]/.test(s) && /[A-Z]/.test(s)) return true;
      }
      return false;
    }, why: "a long high-entropy literal (credential?)" },
];

// Optional private additions: one regex per line, `#` for comments. Absent from
// a fresh clone by design — the public checks above have to stand on their own.
const PRIVATE_LIST = join(ROOT, "overlay", "forbidden.txt");
if (existsSync(PRIVATE_LIST)) {
  for (const raw of readFileSync(PRIVATE_LIST, "utf8").split("\n")) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) FORBIDDEN.push({ re: new RegExp(line, "i"), why: "a known private value" });
  }
}

// Files where a match is legitimate: the docs name the author on purpose, and
// this scanner necessarily discusses the shapes it hunts.
const SCAN_SKIP = new Set(["tools/build-public.mjs", "README.md", "GETTING_STARTED.md", "LICENSE"]);

const TEXT_EXT = new Set([".js", ".mjs", ".json", ".html", ".css", ".md", ".toml", ".ps1", ".py", ".webmanifest", ".txt"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (EXCLUDE_RE.test(relative(ROOT, p))) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// --- assemble ----------------------------------------------------------------
if (existsSync(TARGET)) rmSync(TARGET, { recursive: true, force: true });
mkdirSync(TARGET, { recursive: true });

const copied = [];
function copyOne(abs) {
  const rel = relative(ROOT, abs).replace(/\\/g, "/");
  const dest = join(TARGET, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(abs, dest);
  copied.push(rel);
}
for (const d of DIRS) for (const f of walk(join(ROOT, d))) copyOne(f);
for (const f of FILES) {
  const abs = join(ROOT, f);
  if (!existsSync(abs)) { console.error(`missing expected file: ${f}`); process.exit(1); }
  copyOne(abs);
}
for (const [src, dst] of Object.entries(RENAMES)) {
  const abs = join(ROOT, src);
  if (!existsSync(abs)) { console.error(`missing expected file: ${src}`); process.exit(1); }
  const dest = join(TARGET, dst);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(abs, dest);
  copied.push(dst);
}

// --- scan --------------------------------------------------------------------
const hits = [];
for (const rel of copied) {
  if (SCAN_SKIP.has(rel)) continue;
  if (!TEXT_EXT.has(extname(rel))) continue;
  const src = readFileSync(join(TARGET, rel), "utf8");
  const lines = src.split("\n");
  for (const { re, test, why, allow } of FORBIDDEN) {
    lines.forEach((line, i) => {
      // `allow` exempts the documented placeholder forms ("your-app.pages.dev"),
      // which must survive — they're how a self-hoster knows what to replace.
      const hit = test ? test(line) : re.test(line);
      if (hit && !(allow && allow.test(line))) {
        hits.push({ rel, line: i + 1, why, text: line.trim().slice(0, 110) });
      }
    });
  }
}

// The public config must be empty — the single most important invariant here.
const cfg = readFileSync(join(TARGET, "js/config.js"), "utf8");
for (const [pattern, why] of [[/endpoint:\s*"/, "a baked-in endpoint"], [/token:\s*"/, "a baked-in token"], [/legacyDefaults:\s*\{/, "seeded personal defaults"]]) {
  if (pattern.test(cfg)) hits.push({ rel: "js/config.js", line: 0, why, text: "public config must ship empty" });
}
// No program plans may ship: a public install has none by design.
if (existsSync(join(TARGET, "data"))) hits.push({ rel: "data/", line: 0, why: "shipped program plans", text: "public builds carry no programs" });

console.log(`assembled ${copied.length} files into ${TARGET}`);
if (hits.length) {
  console.error(`\nREFUSING TO PUBLISH — ${hits.length} problem(s):`);
  for (const h of hits) console.error(`  ${h.rel}:${h.line}  [${h.why}]\n      ${h.text}`);
  rmSync(TARGET, { recursive: true, force: true });
  process.exit(1);
}
console.log("scan clean — no credentials, endpoints, medical history or personal identifiers");
