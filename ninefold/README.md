# Ninefold

A training app that writes your plan, runs each session with you, and adjusts the loads from what you actually lift.

Offline-first PWA. No account, no sign-up, no server unless you deploy one yourself. Everything lives in your browser until you decide otherwise.

**Not a developer?** Start with the [step-by-step getting-started guide](./GETTING_STARTED.md).

---

## What it does

**Writes the plan.** Most training apps assume you already have a program. Ninefold builds one, through a wizard grounded in Andy Galpin's framework of nine trainable adaptations: you rank what you're actually training for, say what your week realistically allows, describe your equipment, and it generates a block — split, exercise selection, exercise order, set and rep progression, rest intervals.

The interference model is the part worth stealing. Galpin orders the nine adaptations along a neuromuscular-to-metabolic continuum and notes that *"the closer they are to each other on the list, the more compatible."* That makes conflict **computable** rather than a table someone hand-wrote — skill and speed sit together and train together happily; hypertrophy and speed span most of the spectrum, and the app says so before you build a block that fights itself.

**Runs the session.** Pre-routine → core → post-routine → summary, with a timed routine engine (voice cues, haptics, wake lock, lock-screen audio), implement-aware weight entry (an illustrated plate calculator, a dumbbell scroller that snaps to the weights actually on your rack), ghosted previous values, and a rest timer.

**Coaches the progression.** An autoregulating engine prescribes each lift's next load and reps by double progression, bridges rep-range changes with an effort-adjusted estimated 1RM, snaps every prescription to weights you can physically load, and detects stalls. It never prescribes a dumbbell you don't own.

**Adapts to where you are.** Describe more than one place — a gym, a home rack, a hotel room — and when you train somewhere without the right kit, the app swaps in matched movements and *back-calculates* the result onto the planned lift, so your progression carries on.

**Reads your body, if you want.** Optional WHOOP or Apple Health integration for recovery, sleep, workouts and daily burn; a readiness check that eases loads on a bad day; weekly volume per muscle against MEV/MAV landmarks; strength standards; body composition.

Everything optional is off by default.

## What it isn't

- **Not medical advice.** General fitness software. It knows nothing about your injuries, and its prescriptions come from published training heuristics plus your own logged performance. Carrying an injury, or coming back from surgery? Get a plan from a physiotherapist.
- **Not a social app.** No feed, no friends, no leaderboard.
- **Not hosted for you.** There's no ninefold.com. You deploy it, or you run it locally. That's the trade for it being genuinely yours.

## Architecture

**Buildless.** Plain ES modules, no framework, no bundler, no build step. What you read is what runs. It deploys as static files and it will still work in ten years.

- **IndexedDB** for all data, via a small hand-rolled promise wrapper. No dependency.
- **Service worker**, cache-first, so a workout runs with zero connectivity.
- **Pure engines**, no DOM: `progression.js` (load prescription), `cardio-intel.js` (HR zones, VO₂max, next-session targets), `volume.js` (weekly sets vs landmarks), `substitution.js` (cross-location swaps), `builder/` (program generation), `standards.js` (strength benchmarks). All unit tested.
- **Stored data is always metric.** Units are a display concern, converted at the edges — so switching them never invalidates a single logged session. An imperial gym is modelled as real 45/25/10/5/2.5 lb plates expressed in kg, so the engine rounds to weights that physically exist on that rack.
- **Two optional Cloudflare Workers**: `backup-worker/` (durable off-device backup, token-protected KV) and `whoop-worker/` (an OAuth broker, because a PWA cannot hold a client secret).

```
js/
  builder/       program generation (9 adaptations, interference, generator)
  health/        one interface over WHOOP / Apple Health / nothing
  components/    plate calc, steppers, charts, timers, orb, confetti
  views/         one file per screen
  *.js           pure engines + data access
tools/
  check.mjs      resolves every import; parses every file as a real ES module
  test.mjs       assertions for the pure engines
  build-public.mjs   assembles the public tree and refuses on anything personal
```

## Running it

```bash
python -m http.server 8123      # ES modules need http://, not file://
```

Then open `http://localhost:8123`. That's the whole development setup.

```bash
node tools/check.mjs            # imports resolve, every module parses
node tools/test.mjs             # the engines behave
```

To install it on a phone, deploy the folder as static files anywhere (Cloudflare Pages, Netlify, GitHub Pages) and use "Add to Home Screen". See [GETTING_STARTED.md](./GETTING_STARTED.md).

## Optional: your own backup and tracker

The app is local-only until you point it at services **you** deploy. Nothing is shared and there is no instance to borrow — WHOOP caps unapproved developer apps to a handful of users, and a shared backup endpoint would mean trusting a stranger with your training log.

Both are configured in Settings, so you can run the public code unchanged. See the getting-started guide.

## A note on the origin of this

This was built for one person over about fourteen months, then generalised. The engines are the interesting part precisely because they were tuned against real training data and corrected when they got things wrong — the comments record several of those corrections, including the ones that were embarrassing.

Generalising it removed a lot: hardcoded cities, a specific body's goal weight, strength standards that silently assumed one sex, a rehab program built around one set of injuries. `tools/build-public.mjs` encodes every category of that as a scan which fails the build, so none of it comes back.

## Credits

- Programming framework: Andy Galpin's guest series on Huberman Lab (parts 1-4).
- Anatomical muscle map adapted from [react-body-highlighter](https://github.com/giavinh79/react-body-highlighter) (MIT).
- [Sora](https://github.com/google/fonts/tree/main/ofl/sora) typeface, SIL OFL 1.1.
- Everything else — exercise figures, engines, UI — hand-authored here. See [THIRD-PARTY.md](./THIRD-PARTY.md).

## License

MIT. See [LICENSE](../LICENSE).

By [@till-hohmann](https://github.com/till-hohmann).
