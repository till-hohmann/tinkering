# Getting started with Ninefold

This guide assumes you are **not** a developer. It takes about fifteen minutes to get the app on your phone, and you can stop after step 2 if you just want to try it.

There is no account to create and nothing to pay for.

---

## Step 1 — Try it on your computer first (2 minutes)

Download this folder ([green **Code** button → **Download ZIP**](https://github.com/till-hohmann/tinkering), then unzip and find the `ninefold` folder inside).

The app can't just be opened by double-clicking `index.html` — browsers block the way it loads its own code from a plain file. It needs a tiny local web server, which your computer probably already has.

**On a Mac**, open Terminal (⌘-Space, type "Terminal"), then:

```bash
cd ~/Downloads/tinkering-main/ninefold
python3 -m http.server 8123
```

**On Windows**, open PowerShell (Start menu, type "PowerShell"), then:

```bash
cd $HOME\Downloads\tinkering-main\ninefold
python -m http.server 8123
```

Now open **http://localhost:8123** in your browser. You'll be asked a few questions, then you can build a training block and click through a session.

To stop the server, press Ctrl-C in that window.

> If you get "command not found: python3", install Python from [python.org](https://www.python.org/downloads/) and try again.

---

## Step 2 — Put it on your phone (10 minutes)

To use it in a gym you need it hosted at a real web address. **Cloudflare Pages** does this for free.

1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. In the sidebar choose **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
3. Name it whatever you like (`my-training`, say).
4. Drag the **contents** of the `ninefold` folder onto the upload area — the files themselves, not the folder. It should include `index.html` at the top level.
5. Click **Deploy**. You'll get a URL like `https://my-training.pages.dev`.

Then on your phone:

- **iPhone:** open that URL **in Safari** (not Chrome — only Safari can install web apps), tap the Share button, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the ⋮ menu, then **Install app**.

It now behaves like a normal app: full screen, its own icon, and it works with no signal.

> That URL is unguessable but not secret. Anyone who has it can open your app. It's the same trade as an unlisted document link — fine for personal use, not a substitute for a password.

**You can stop here.** Everything works. The rest is optional.

---

## Step 3 — Optional: back up your data (10 minutes)

By default your training log lives only in your phone's browser. That's private, but it means clearing your browser data, or deleting and reinstalling the app, loses everything.

Two ways to protect it:

**The simple way.** Settings → *Backup & vault export* → **Backup (.json)**, every couple of weeks. Save the file somewhere. Settings → *Import / restore* brings it back. No setup at all.

**The automatic way** — a small service that mirrors your data as you use it. It's free, but it needs a command line.

<details>
<summary>Set up automatic backup</summary>

You'll need [Node.js](https://nodejs.org) installed. Then:

```bash
cd ninefold/backup-worker
npx wrangler login
npx wrangler kv namespace create BACKUP
```

That last command prints an `id`. Open `wrangler.toml`, replace `PUT_YOUR_KV_NAMESPACE_ID_HERE` with it, and save.

Now invent a long random password — this protects your whole training log, so use a password manager to generate one:

```bash
npx wrangler secret put BACKUP_TOKEN
```

Paste it at the prompt (never type it on the command line — it would end up in your shell history). Then:

```bash
npx wrangler deploy
```

It prints a URL like `https://ninefold-backup.you.workers.dev`.

Finally, in the app: **Settings → Cloud backup**, paste that URL and the same password, tap **Save**, then **Test connection**. It should say "Reachable".

</details>

---

## Step 4 — Optional: connect a wearable

**Apple Watch / iPhone.** A web app can't read Apple Health directly — Apple provides no way. Instead your phone *sends* a small daily summary to your own backup service (step 3 is required first).

In the app: **Settings → Tracker → Apple Health → Set up the Health bridge**. It gives you a URL and the exact steps for building a Shortcut that runs each morning. If you'd rather not build one, the **Health Auto Export** app (a few pounds on the App Store) does the same thing with no scripting.

**WHOOP.** Needs your own free developer app at [developer.whoop.com](https://developer.whoop.com) plus deploying `whoop-worker/`. See [whoop-worker/README.md](./whoop-worker/README.md). WHOOP limits unapproved apps to a small number of users, which is why there's no shared service to join.

**Neither.** Perfectly fine. You log runs and weigh-ins by hand; every other feature is identical. The only things genuinely unavailable are a recovery score, a daily calorie burn, and per-workout heart-rate zones — none of which anything else depends on.

---

## Step 5 — Optional: build the yoga narration

The Yoga tab talks you through each pose — names it, tells you how to get in, what matters, how long you're staying. **That narration is not in this repository.** It is about 107 MB of rendered audio, which is a build artefact rather than source, so you generate it yourself:

```bash
pip install edge-tts
python tools/build-voice.py --level all
```

That writes `audio/yoga/{beginner,advanced,expert}/` and takes roughly **90 minutes** — it is calling a speech service once per sentence, about 4,700 of them. You can do one level instead (`--level advanced`) in a third of the time. It is safe to interrupt and re-run: finished clips are skipped.

The words themselves *are* source, in [`js/yoga/cues.js`](./js/yoga/cues.js) — one entry per pose, which is the file to edit if you want different cues, a different tone, or another language. Re-run the renderer afterwards and only the changed lines are rebuilt.

**Without this step everything else works and the practice simply runs silent** — you get the pose, the figure, the written cue and the breath pacer, just no voice. The Yoga tab says so rather than leaving you wondering.

To use a different voice, change `VOICE` at the top of `tools/build-voice.py`; `python -c "import asyncio,edge_tts;print([v['ShortName'] for v in asyncio.run(edge_tts.list_voices())])"` lists what's available.

---

## Common questions

**Does my data go anywhere?**
No, unless you set up step 3 or 4 — and then it goes to services *you* deployed, on your own account. There is no analytics, no telemetry, and nothing phones home. You can verify that: search the code for `fetch(` and every result is a service you configured.

**Can I use pounds?**
Yes — chosen during setup, changeable in Settings. Weights are stored in one internal format, so switching later never invalidates anything you've already logged. An imperial gym is modelled as real 45/25/10/5/2.5 lb plates, so the app only ever prescribes weights you can actually load.

**I have no equipment at all.**
It works. Say so during setup and you'll get a bodyweight program — squats, push-ups, inverted rows, pull-ups if you have a bar, hinges, lunges and core. The builder will tell you which patterns it can't cover.

**How do I delete everything?**
Settings → **Delete all data**. It asks you to type DELETE, then removes everything from the device. If you set up cloud backup, clear that separately — it's your service and the app deliberately won't touch it.

**Something's broken.**
Open an issue on [the repository](https://github.com/till-hohmann/tinkering/issues). Including what you were doing and what your phone is helps a lot.
