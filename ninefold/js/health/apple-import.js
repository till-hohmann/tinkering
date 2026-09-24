// health/apple-import.js — read Apple Health's own export archive.
//
// The Shortcuts bridge (see apple.js) keeps you current from the day you set it
// up. This is the other half: everything BEFORE that. Apple's Health app can
// export its entire database, and for most people that's years of weight,
// resting heart rate, HRV, VO₂max and workouts that would otherwise be invisible
// to the app forever.
//
// THREE THINGS SHAPE THIS FILE.
//
// 1. SIZE. A five-year export with an Apple Watch is commonly 200-500 MB, and
//    heavy users reach 1.5 GB. Reading that with FileReader.readAsText would
//    allocate the whole thing as a JS string and kill the tab. So everything
//    here streams: the file is consumed chunk by chunk, records are matched as
//    they go past, and only the aggregate survives.
//
// 2. IT'S A ZIP. Apple exports `export.zip`, and browsers have no built-in
//    unzip. Rather than take a dependency (this project has none), there's a
//    minimal reader below: ZIP stores each entry deflate-raw, and
//    DecompressionStream('deflate-raw') is standard in every current browser.
//    We read the central directory from the tail of the file, find export.xml,
//    and stream just that entry through the decompressor. File.slice() means
//    none of this loads the archive into memory.
//
// 3. IT'S NOT WELL-BEHAVED XML for our purposes — it's tens of millions of flat
//    <Record/> elements. A DOM parser would need the whole document. A regex
//    scan over a sliding buffer is the right tool here, and the only real
//    subtlety is carrying the tail of each chunk forward in case a tag straddles
//    a boundary.
//
// Output is the SAME per-date shape the Shortcuts bridge posts, so both paths
// feed one store and the provider doesn't care which produced a given day.

const RECORD_RE = /<Record\s+([^>]*?)\/?>/g;
const WORKOUT_RE = /<Workout\s+([^>]*?)(?:\/>|>)/g;
const ATTR_RE = /(\w+)="([^"]*)"/g;

// Types worth carrying. Everything else in the export — step counts, audio
// exposure, tens of millions of individual heart-rate samples — is either
// irrelevant here or far too granular to keep, and skipping them early is most
// of what makes this fast.
const WANTED = new Set([
  "HKQuantityTypeIdentifierBodyMass",
  "HKQuantityTypeIdentifierVO2Max",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierBodyFatPercentage",
  "HKQuantityTypeIdentifierLeanBodyMass",
  "HKQuantityTypeIdentifierWaistCircumference",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierBasalEnergyBurned",
  "HKCategoryTypeIdentifierSleepAnalysis",
]);

function attrs(s) {
  const out = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) out[m[1]] = m[2];
  return out;
}

// Apple writes "2026-05-01 09:14:23 -0700". The LOCAL calendar date is the first
// ten characters — the timestamp is already expressed in the zone it was
// recorded in, so no conversion is wanted. Doing the "correct" thing and
// normalising to UTC would silently move late-evening records onto the next day.
const localDate = (s) => (typeof s === "string" && s.length >= 10 ? s.slice(0, 10) : null);

// --- unit handling -----------------------------------------------------------
// Apple exports in whatever unit the phone is set to, so a US export says lb and
// in. Everything stored by this app is metric.
const LB_TO_KG = 0.45359237, IN_TO_CM = 2.54;
function toKg(v, unit) {
  if (!Number.isFinite(v)) return null;
  const u = (unit || "").toLowerCase();
  if (u === "lb") return v * LB_TO_KG;
  if (u === "g") return v / 1000;
  if (u === "st") return v * 6.35029318;
  return v;                                   // kg, or unspecified
}
function toCm(v, unit) {
  if (!Number.isFinite(v)) return null;
  const u = (unit || "").toLowerCase();
  if (u === "in") return v * IN_TO_CM;
  if (u === "m") return v * 100;
  return v;
}
// CASE-SENSITIVE on purpose. Apple writes "Cal" meaning KILOcalorie (the dietary
// Calorie), while a lowercase "cal" is a gram-calorie, a thousand times smaller.
// Lowercasing the unit first — which every other converter here does safely —
// silently divided every energy value by 1000, turning a 550 kcal day into 1.
function toKcal(v, unit) {
  if (!Number.isFinite(v)) return null;
  const u = (unit || "").trim();
  if (/^kj$/i.test(u)) return v / 4.184;
  if (u === "Cal" || /^kcal$/i.test(u)) return v;
  if (u === "cal") return v / 1000;
  return v;                                   // unspecified: assume kcal
}

// "2026-05-01 09:14:23 -0700" -> epoch ms. Date.parse can't read Apple's format
// directly, and the obvious fix (replace(" ", "T")) only replaces the FIRST
// space, leaving "2026-05-01T09:14:23 -0700" — which parses as NaN in strict
// engines and silently dropped every sleep record.
export function appleTime(s) {
  if (typeof s !== "string") return NaN;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})?$/.exec(s.trim());
  if (m) return Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4] || "00"}`);
  return Date.parse(s.replace(" ", "T"));     // already ISO, or no offset
}

// --- the aggregator ----------------------------------------------------------
function makeAcc() {
  return { byDate: Object.create(null), workouts: [], counts: Object.create(null), unitsSeen: new Set() };
}

function bump(acc, type) { acc.counts[type] = (acc.counts[type] || 0) + 1; }
function day(acc, d) {
  if (!acc.byDate[d]) acc.byDate[d] = { date: d, _hrv: [], _rhr: [] };
  return acc.byDate[d];
}

function takeRecord(acc, a) {
  const type = a.type;
  if (!WANTED.has(type)) return;
  const d = localDate(a.startDate || a.creationDate);
  if (!d) return;
  const v = Number(a.value);
  bump(acc, type);
  if (a.unit) acc.unitsSeen.add(a.unit);
  const rec = day(acc, d);

  switch (type) {
    case "HKQuantityTypeIdentifierBodyMass":
      // Several weigh-ins a day happen; the last is the one people mean.
      rec.weightKg = toKg(v, a.unit); break;
    case "HKQuantityTypeIdentifierVO2Max":
      rec.vo2max = v; break;
    case "HKQuantityTypeIdentifierRestingHeartRate":
      rec._rhr.push(v); break;
    case "HKQuantityTypeIdentifierHeartRateVariabilitySDNN":
      // NOTE: Apple reports SDNN; WHOOP reports RMSSD. They are different
      // statistics over the same beat intervals and are NOT interchangeable —
      // SDNN typically reads higher. Kept because the app only ever compares
      // HRV against the user's OWN baseline, never across devices.
      rec._hrv.push(v); break;
    case "HKQuantityTypeIdentifierBodyFatPercentage":
      // Apple stores a fraction (0.18), not a percentage.
      rec.bodyFatPct = v <= 1 ? v * 100 : v; break;
    case "HKQuantityTypeIdentifierLeanBodyMass":
      rec.leanKg = toKg(v, a.unit); break;
    case "HKQuantityTypeIdentifierWaistCircumference":
      rec.waistCm = toCm(v, a.unit); break;
    case "HKQuantityTypeIdentifierActiveEnergyBurned":
      rec.activeKcal = (rec.activeKcal || 0) + (toKcal(v, a.unit) || 0); break;
    case "HKQuantityTypeIdentifierBasalEnergyBurned":
      rec.basalKcal = (rec.basalKcal || 0) + (toKcal(v, a.unit) || 0); break;
    case "HKCategoryTypeIdentifierSleepAnalysis": {
      // Only the asleep stages count — "InBed" and "Awake" would inflate it.
      // Sleep is attributed to the date it ENDS on, i.e. the morning you wake,
      // which is how the rest of the app reads "last night".
      if (!/Asleep/i.test(a.value || "")) return;
      const start = appleTime(a.startDate);
      const end = appleTime(a.endDate);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      const wake = localDate(a.endDate) || d;
      const w = day(acc, wake);
      w.sleepHours = (w.sleepHours || 0) + (end - start) / 3600000;
      break;
    }
  }
}

function takeWorkout(acc, a) {
  const d = localDate(a.startDate);
  if (!d) return;
  bump(acc, "Workout");
  const sport = (a.workoutActivityType || "").replace(/^HKWorkoutActivityType/, "");
  const mins = Number(a.duration);
  const distRaw = Number(a.totalDistance);
  const distUnit = (a.totalDistanceUnit || "").toLowerCase();
  const km = Number.isFinite(distRaw) ? (distUnit === "mi" ? distRaw * 1.609344 : distRaw) : null;
  acc.workouts.push({
    date: d, sport,
    timeSeconds: Number.isFinite(mins) ? Math.round(mins * 60) : null,
    distanceKm: km != null ? Math.round(km * 100) / 100 : null,
    kcal: Number.isFinite(Number(a.totalEnergyBurned)) ? Math.round(Number(a.totalEnergyBurned)) : null,
    source: "apple-import",
  });
}

// Collapse the per-day accumulators into the final record shape.
function finalise(acc) {
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const byDate = {};
  for (const [d, r] of Object.entries(acc.byDate)) {
    const out = { date: d };
    const rhr = mean(r._rhr), hrv = mean(r._hrv);
    if (rhr != null) out.restingHR = Math.round(rhr);
    if (hrv != null) out.hrv = Math.round(hrv);
    if (r.weightKg != null) out.weightKg = Math.round(r.weightKg * 10) / 10;
    if (r.vo2max != null) out.vo2max = Math.round(r.vo2max * 10) / 10;
    if (r.bodyFatPct != null) out.bodyFatPct = Math.round(r.bodyFatPct * 10) / 10;
    if (r.leanKg != null) out.leanKg = Math.round(r.leanKg * 10) / 10;
    if (r.waistCm != null) out.waistCm = Math.round(r.waistCm * 10) / 10;
    if (r.activeKcal) out.activeKcal = Math.round(r.activeKcal);
    if (r.basalKcal) out.basalKcal = Math.round(r.basalKcal);
    if (r.sleepHours) out.sleepHours = Math.round(r.sleepHours * 10) / 10;
    if (Object.keys(out).length > 1) byDate[d] = out;
  }
  // Workouts: cardio only, and deduplicated. Apple records the same session from
  // both the Watch and the phone often enough that importing raw would double
  // every run.
  const seen = new Set();
  const workouts = acc.workouts
    .filter((w) => /run|walk|cycl|elliptical|row|hiit|swim|hike|stair/i.test(w.sport))
    .filter((w) => {
      const k = `${w.date}|${w.sport}|${Math.round((w.timeSeconds || 0) / 60)}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { byDate, workouts, counts: acc.counts };
}

// --- ZIP ---------------------------------------------------------------------
// Minimal reader: locate the End Of Central Directory record in the last 64 KB,
// walk the central directory for the entry we want, then read its local header
// to find where the compressed bytes actually start. Only that slice is streamed.
async function zipEntryStream(file, wantName) {
  const tailLen = Math.min(file.size, 65536 + 22);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-directory record).");
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);

  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  let p = 0, found = null;
  while (p + 46 <= cd.byteLength) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOff = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // Entries are usually "apple_health_export/export.xml".
    if (name.endsWith(wantName)) { found = { method, compSize, localOff, name }; break; }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!found) throw new Error(`${wantName} not found inside the zip.`);

  // The local header repeats the name/extra lengths, and they can differ from
  // the central directory's — the data offset must come from the local header.
  const lh = new DataView(await file.slice(found.localOff, found.localOff + 30).arrayBuffer());
  if (lh.getUint32(0, true) !== 0x04034b50) throw new Error("Damaged zip entry header.");
  const dataStart = found.localOff + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  const slice = file.slice(dataStart, dataStart + found.compSize);

  if (found.method === 0) return slice.stream();              // stored, no compression
  if (found.method !== 8) throw new Error(`Unsupported zip compression (method ${found.method}).`);
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser can't unzip. Unzip the export yourself and pick export.xml.");
  }
  return slice.stream().pipeThrough(new DecompressionStream("deflate-raw"));
}

// --- the entry point ---------------------------------------------------------
// `onProgress({ bytes, records, days })` is called a few times a second so a
// long import can show it's alive — an import that looks frozen for two minutes
// gets cancelled by the user every time.
export async function parseAppleExport(file, { onProgress } = {}) {
  const isZip = /\.zip$/i.test(file.name || "");
  const stream = isZip ? await zipEntryStream(file, "export.xml") : file.stream();
  const reader = stream.pipeThrough(new TextDecoderStream("utf-8", { fatal: false })).getReader();

  const acc = makeAcc();
  let carry = "", bytes = 0, records = 0, lastTick = 0;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    const buf = carry + value;

    RECORD_RE.lastIndex = 0;
    let m, lastEnd = 0;
    while ((m = RECORD_RE.exec(buf))) {
      takeRecord(acc, attrs(m[1]));
      records++;
      lastEnd = RECORD_RE.lastIndex;
    }
    WORKOUT_RE.lastIndex = 0;
    while ((m = WORKOUT_RE.exec(buf))) {
      takeWorkout(acc, attrs(m[1]));
      lastEnd = Math.max(lastEnd, WORKOUT_RE.lastIndex);
    }
    // Carry the unconsumed tail so a tag split across chunks isn't lost. Capped
    // so a chunk containing no matches at all can't grow the buffer without end.
    carry = buf.slice(Math.max(lastEnd, buf.length - 8192));

    const now = Date.now();
    if (onProgress && now - lastTick > 250) {
      lastTick = now;
      onProgress({ bytes, records, days: Object.keys(acc.byDate).length });
    }
  }

  const result = finalise(acc);
  if (onProgress) onProgress({ bytes, records, days: Object.keys(result.byDate).length, done: true });

  const warnings = [];
  if (!records) warnings.push("No health records found — is this really an Apple Health export?");
  if (result.counts.HKQuantityTypeIdentifierHeartRateVariabilitySDNN) {
    warnings.push("Apple records HRV as SDNN; WHOOP uses RMSSD. They aren't the same statistic, so don't compare the two directly — the app only ever measures HRV against your own baseline.");
  }
  return { ...result, warnings, bytes, records };
}

// Human-readable summary for the import screen.
export function summarise(result) {
  const dates = Object.keys(result.byDate).sort();
  const has = (k) => dates.filter((d) => result.byDate[d][k] != null).length;
  return {
    days: dates.length,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    weight: has("weightKg"),
    restingHR: has("restingHR"),
    hrv: has("hrv"),
    sleep: has("sleepHours"),
    energy: has("activeKcal"),
    vo2max: has("vo2max"),
    waist: has("waistCm"),
    workouts: (result.workouts || []).length,
  };
}

// --- writing it in ------------------------------------------------------------
// The parsed days go into the Apple store the provider reads, AND into the app's
// own first-class logs where they belong. That second half matters: the Body
// chart reads weightLog, Progress reads vo2maxLog, and the recomp scorecard
// reads measurementsLog. Leaving everything in the provider store would mean an
// import loaded a lot of data that no chart could see.
//
// Every write is additive and date-keyed, so re-importing the same file twice is
// a no-op rather than a duplicate.
export async function applyImport(result, { onStep } = {}) {
  const store = await import("../store.js");
  const step = (m) => { if (onStep) onStep(m); };
  const byDate = result.byDate || {};

  step("Saving health history…");
  const merged = await store.mergeAppleHealthLog(byDate);

  // Bodyweight -> the dated weight series the Body chart plots.
  step("Weigh-ins…");
  let weights = 0;
  for (const [d, r] of Object.entries(byDate)) {
    if (r.weightKg != null) { await store.addWeight(d, r.weightKg); weights++; }
  }

  // VO2max -> its own trend. Apple computes this natively, which is the one
  // metric where an Apple user is better served than a WHOOP one.
  step("VO₂max…");
  let vo2 = 0;
  for (const [d, r] of Object.entries(byDate)) {
    if (r.vo2max != null) { await store.addVO2max(r.vo2max, d); vo2++; }
  }

  // Waist -> the measurements log (the recomp fat signal).
  step("Measurements…");
  let waist = 0;
  for (const [d, r] of Object.entries(byDate)) {
    if (r.waistCm != null) { await store.addMeasurement(d, { waistCm: r.waistCm }); waist++; }
  }

  // Workouts are deliberately NOT written as sessions. A session in this app is
  // something the app prescribed and you executed, with a program, a weekday key
  // and a place — the spine of every comparison and PR. Back-filling hundreds of
  // synthetic sessions from Apple would corrupt exactly that. They stay in the
  // health store, where the cardio auto-fill can offer them.
  return { days: merged.total, added: merged.added, updated: merged.updated, weights, vo2, waist,
    workouts: (result.workouts || []).length };
}
