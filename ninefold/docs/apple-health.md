# Apple Health → Ninefold

A web app cannot read Apple Health. There is no web API, Safari exposes nothing,
and Web Bluetooth is unsupported on iOS — so there is no way for the app to *pull*
your health data without shipping a native wrapper.

Instead your phone **pushes**. A Shortcut runs on a schedule, reads the day's
samples with Apple's own health actions, and POSTs them to your backup Worker.
You decide exactly which metrics are sent, and turning the automation off stops it
immediately.

The consequence to design around: your data is as fresh as the last Shortcut run,
not as fresh as the last app launch. The app shows the date of the last push for
exactly this reason — a bridge that has stopped must look stopped.

## What to send

POST to your backup Worker's `/health-ingest` route with your backup token as a
bearer token. One object, containing a `days` array:

```json
{
  "days": [
    {
      "date":       "2026-08-09",
      "restingHR":  50,
      "hrv":        116,
      "sleepHours": 7.4,
      "weightKg":   72.5,
      "activeKcal": 780,
      "basalKcal":  1500,
      "vo2max":     44.2
    }
  ]
}
```

### The shape Shortcuts finds easy

A single day may also be posted **unwrapped**, which is what you want when building
this in Shortcuts:

```json
{ "date": "2026-08-09", "restingHR": 52, "hrv": 98, "sleepHours": 7.1 }
```

That matters more than it looks. With this shape you can set *Get Contents of URL*
→ **Request Body: JSON** and add one flat field per metric in the Shortcuts UI. The
wrapped shape needs an array of dictionaries, which in practice means composing the
JSON in a **Text** action and routing it through a file variable — a step that
fails silently and reports itself as *"The network connection was lost."*

A bare array `[ { … } ]` is accepted too. All three shapes behave identically.

### Send decimals as Text

Shortcuts' JSON **Number** field type **truncates decimals**: 7.1 hours of sleep
arrives as 7, a 96.2 kg weigh-in as 96, a 44.2 VO₂max as 44. Use the **Text** field
type for anything with a decimal point — every field here is parsed numerically, so
a quoted `"7.1"` counts exactly as `7.1` does.

`date` is always Text.

**The key names are read exactly as written.** This is the one thing to get right:
the Worker stores whatever it is given, so a Shortcut sending `restingHeartRate`
instead of `restingHR` will push successfully, report a fresh timestamp, and
deliver nothing the app can read. (Settings notices this and says so, naming the
keys it didn't recognise — but it is easier to just match the list.)

Send only what you have. Anything missing is simply not shown.

| Field | Unit | What it powers |
|---|---|---|
| `date` | `YYYY-MM-DD` | **Required.** A day without one is skipped. |
| `restingHR` | bpm | Readiness |
| `hrv` | ms | Readiness — the most heavily weighted input |
| `sleepHours` | hours | Readiness |
| `weightKg` | kg | Bodyweight trend, protein target, strength benchmark |
| `activeKcal` | kcal | Calories out, training-load trend |
| `basalKcal` | kcal | Calories out (added to active) |
| `vo2max` | ml/kg/min | Cardio fitness trend |

Weight is always **kilograms** on the wire, whatever units you read in — the app
stores metric and converts at the edges.

Days merge by date and the last write wins per field, so a Shortcut that reruns or
backfills is safe to run as often as you like.

### Workouts (optional)

A day may also carry a `workouts` array. Field names are matched loosely here,
because Shortcut authors rename things:

```json
"workouts": [
  { "type": "Running", "durationSeconds": 2400, "distanceMeters": 7200,
    "avgHR": 148, "maxHR": 171, "activeKcal": 520,
    "hrSamples": [ { "t": 1754697600000, "bpm": 132 } ] }
]
```

`hrSamples` (epoch milliseconds and bpm) is what lets the app compute time in
**your** heart-rate zones rather than a vendor's bands. Without it you still get
distance, duration and average HR.

## Building the Shortcut

1. **Shortcuts → new shortcut.**
2. Add a **Find Health Samples** action per metric — resting heart rate, HRV,
   sleep, weight, active energy, basal energy, VO₂max. Take the average or the
   most recent, whichever suits the metric.
3. Build a **Dictionary** matching the shape above, then a **Text** action holding
   the JSON.
4. **Get Contents of URL** — method `POST`, request body `File`/`Text` with the
   JSON, and a header `Authorization` set to `Bearer YOUR_TOKEN`.
5. **Automation → Time of Day**, every morning, *Run Without Asking*. Once a day
   is plenty.

Run it once by hand, then open **Profile → Tracker**. It should show the last push
date. If it shows a red line naming unrecognised keys, your dictionary keys don't
match the table above.

### When it doesn't work

Three failures account for almost everything, and all three were hit while this
was being written.

**`unauthorized`, and you're sure the token is right.** Check whether the header
arrived at all before blaming the token. In Shortcuts a header row only commits
when the field **loses focus** — type a value, tap ▶ straight away, and the entire
row is silently dropped, so the request goes out with no Authorization at all.
Fill the Key, tap Done; fill the Value, tap Done; tap the action's background so
nothing has focus; *then* run.

**"The network connection was lost."** Usually not a network problem. It's what
Shortcuts says when it can't build the request body — most often *Request Body:
File* pointing at a variable that isn't set. Use **Request Body: JSON** with flat
fields and the problem disappears.

**It pushes fine and nothing appears in the app.** The keys don't match. The
Worker stores whatever it is sent, so a wrong name is a successful push carrying
nothing readable. Profile → Tracker names the keys it didn't recognise.

### If you would rather not build one

The **Health Auto Export** app (App Store, a few pounds) does the same job with no
scripting: point it at the same URL, add the same Authorization header, and map
the fields to the names above.

## Importing your history

The Shortcut only knows about days after you set it up. To load everything before
that, export from the Health app (profile picture → **Export All Health Data**)
and import the `.zip` in **Profile → Tracker → Import history**.

That path needs no backend at all — it works on a local-only install. Note it is
kept **on the device** and is not part of the cloud backup: it can run to hundreds
of kilobytes and is re-creatable from the export, so **keep the export file** if
you care about that history surviving a wipe.

## What Apple gives that a strap doesn't

- **VO₂max**, computed natively as Cardio Fitness. Most straps don't expose one.
- **Raw HR samples**, which let zone minutes be computed against your own zones.

## What it doesn't give

A recovery score. Apple exposes the inputs but no verdict, so the app derives one
from your HRV, resting HR and sleep against **your own 28-day baseline** and labels
it as an estimate. It needs about five days of history before it says anything —
that quiet first week is by design, not a fault.
