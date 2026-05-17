# Getting Started

A step-by-step guide to set up the LinkedIn Engagement Console with Claude. Two tracks. Pick the one that matches the Claude product you use.

- **[Track A: Claude Cowork](#track-a-claude-cowork)**. The desktop app for non-developers. More visual, more chat-driven. You will not need to edit code if you do not want to.
- **[Track B: Claude Code](#track-b-claude-code)**. The terminal tool for developers. Slightly faster once set up. Still doable if you can copy-paste a few commands.

Both tracks take about 30 minutes the first time. After that, the daily pass takes 5 minutes.

If you get stuck, jump to [Troubleshooting](#troubleshooting) at the bottom.

---

## What you need (both tracks)

1. A **Claude account** with one of: Claude Pro, Max, Team, or Enterprise.
2. A **LinkedIn account** (the one you want to engage from).
3. About **30 minutes** for first-time setup.
4. Optional: a folder on your computer where you keep your own working notes (any folder is fine; a notes app like Obsidian works too).

You do not need to know how to code. You will paste a few commands into a terminal. You will edit one block of text in one file. That is all.

---

## What this tool does (in one minute)

Every morning you say "linkedin brief" to Claude. Claude:

1. Reads your LinkedIn feed and a list of peer companies you care about.
2. Drafts comments for the top 3 to 5 posts, written in your voice, grounded in what you actually did this week.
3. Surfaces 3 profiles worth following or connecting with.
4. Proposes 1 to 2 ideas for your own posts.
5. Updates a one-page console that looks like LinkedIn (blue, clean, three columns).

You open the console, click "Open in LinkedIn (copies)" on a card, paste, and send. Each card has a "Done" or "Skip" button so the same post does not show up tomorrow.

That is the whole product. The rest of this guide is how to set it up.

---

## Track A: Claude Cowork

This is the easier track if you do not write code for a living.

### Step A1. Install Claude Cowork

1. Open [claude.ai](https://claude.ai) and download the desktop app for Mac or Windows.
2. Open the app, sign in with your Claude account.
3. Make sure you are on the latest version. Cowork mode is included with Pro and higher plans.

### Step A2. Download the LinkedIn Engagement Console

1. Open [github.com/till-hohmann/tinkering](https://github.com/till-hohmann/tinkering) in your browser.
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip the file. You will get a folder called `tinkering-main`. Rename it to `tinkering` if you like.
4. Move the folder somewhere you can find it again. The Documents folder works fine.

### Step A3. Add the folder to Cowork

1. Open Claude Cowork.
2. In the sidebar, find the folder picker. Click **Add folder** or the equivalent.
3. Pick the `tinkering` folder you just unzipped.
4. Cowork can now read and write files in that folder.

### Step A4. Set up your persona

The "persona" is a short description of who you are and how you write. The console uses it when it drafts comments for you. There are two ways to set it.

**Easier way: ask Claude to do it.**

In the Cowork chat, paste this prompt and edit the bracketed part to describe yourself:

```
Open tinkering/linkedin-engagement-console/index.html.
Find the PERSONA block near the top of the file.
Update the 'identity' line to describe me as: [a sentence about who you are, for example: "a marketing director at a B2B SaaS company, posting about real operating reality, not motivational content"].
Update the 'voiceRules' array to match my style.
Keep everything else the same.
```

Claude will open the file, edit it, and confirm. Done.

**Manual way: open the file in a text editor.**

If you prefer, open `tinkering/linkedin-engagement-console/index.html` in any text editor (TextEdit on Mac, Notepad on Windows, or [VS Code](https://code.visualstudio.com) if you have it). Search for `const PERSONA`. You will see a short JavaScript block. Edit the lines between the curly braces. Save the file.

### Step A5. Set up your strategy file

The strategy file is the longer version of "who you want to engage with on LinkedIn". It lists peer companies, people to follow, topics to skip.

1. In the `tinkering/linkedin-engagement-console` folder, find `strategy.template.md`.
2. Make a copy in the same folder, name it `linkedin-strategy.md`.
3. Open the copy in any text editor.
4. Replace every `[PLACEHOLDER]` with your own content. Leave the structure alone, just fill in the blanks.

Or, easier, ask Claude:

```
Open tinkering/linkedin-engagement-console/strategy.template.md.
Save a copy as linkedin-strategy.md in the same folder.
Help me fill it in. I work in [your industry] as [your role]. Ask me questions one at a time so I can answer each one fully before the next.
```

Claude will interview you and fill in the file as you talk.

`linkedin-strategy.md` is in `.gitignore` so it never leaves your machine.

### Step A6. Install the LinkedIn connector

The console reads from a LinkedIn MCP server. MCP stands for Model Context Protocol. It is the bridge that lets Claude talk to LinkedIn safely.

1. Open the install guide for the LinkedIn MCP: [github.com/stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server).
2. Follow the install steps in the upstream README. The Docker option is the easiest if you do not write code. Install [Docker Desktop](https://www.docker.com/products/docker-desktop) first if you do not already have it.
3. The first time you run it, it will open a Chrome window asking you to log into LinkedIn. Log in normally. Your session token gets saved locally. Done once.

Now wire the MCP into Cowork:

1. Open Cowork **Settings**.
2. Go to **MCP servers** (or **Connectors**, the label depends on your version).
3. Click **Add MCP server**.
4. Point it at the LinkedIn MCP you just installed. The upstream README has the exact config snippet. Copy-paste it.
5. Click Save. Cowork will restart the MCP automatically.

If you see a green "Connected" status, you are done with this step.

### Step A7. Run your first brief

In the Cowork chat, type:

```
linkedin brief
```

Claude will:

1. Read your strategy file.
2. Pull your LinkedIn feed and the peer-company feeds.
3. Read your recent notes (if you pointed Cowork at a notes folder).
4. Draft comments and surface engage targets.
5. Update the engagement console with the new data.

This takes about 60 to 90 seconds.

### Step A8. Open the console

In the Cowork chat, say:

```
open the engagement console
```

The console will open in your browser or in Cowork's artifact viewer. Three columns:

- **Comments**: click "Open in LinkedIn (copies)" to jump to the post, the draft is already in your clipboard, paste with Ctrl+V (or Cmd+V on Mac).
- **Engage with**: click "Open profile" to view the person on LinkedIn.
- **Post Ideas**: copy a hook, or click "Expand in chat" to have Claude write the full 120 to 150 word post.

Mark cards as Done or Skip. The console remembers across sessions.

### Step A9. Make it a daily habit (optional)

Cowork supports scheduled tasks. Ask Claude:

```
Schedule a task called "linkedin daily brief" to run every weekday at 9am, with the prompt "linkedin brief".
```

Cowork will set it up. Every weekday at 9am, the console refreshes itself.

---

## Track B: Claude Code

This track is for the terminal tool, [Claude Code](https://claude.com/claude-code). If you are comfortable in a terminal but not writing code, this is fine.

### Step B1. Install Claude Code

```bash
# Mac/Linux
curl -fsSL https://claude.ai/install.sh | sh

# Windows (PowerShell)
iwr -useb https://claude.ai/install.ps1 | iex
```

Then sign in:

```bash
claude login
```

### Step B2. Clone this repo

```bash
git clone https://github.com/till-hohmann/tinkering
cd tinkering/linkedin-engagement-console
```

If you do not have git installed, [install it first](https://git-scm.com/downloads). Or use the ZIP download from Track A Step 2 above.

### Step B3. Install the skill

The skill is the recipe Claude Code follows when you say "linkedin brief". Copy it into your Claude Code skills folder.

**Mac/Linux:**

```bash
mkdir -p ~/.claude/skills/linkedin-engage
cp skill.template.md ~/.claude/skills/linkedin-engage/SKILL.md
```

**Windows (PowerShell):**

```powershell
New-Item -ItemType Directory -Path "$env:USERPROFILE\.claude\skills\linkedin-engage" -Force
Copy-Item skill.template.md "$env:USERPROFILE\.claude\skills\linkedin-engage\SKILL.md"
```

### Step B4. Install the LinkedIn MCP

Same as Track A Step 6: follow [github.com/stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server) to install. The Docker option is the easiest.

Then add it to Claude Code's MCP config. Create a file called `.mcp.json` in the `tinkering` folder (or your project root) with content like:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "stickerdaniel/linkedin-mcp-server"]
    }
  }
}
```

The exact `command` and `args` depend on which install option you picked. The upstream README has the snippet to copy.

### Step B5. Set up your persona

Open `index.html` in any text editor. Find the `const PERSONA` block near the top. Edit `identity`, `voiceRules`, `lensPostures` to match how you write. Save.

If you would rather have Claude do it:

```bash
claude "Open linkedin-engagement-console/index.html. Find the PERSONA block. Update identity to describe me as [your one-line description]. Update voiceRules to match my style. Save."
```

### Step B6. Set up your strategy file

```bash
cp strategy.template.md linkedin-strategy.md
```

Open `linkedin-strategy.md` in any editor and replace the `[PLACEHOLDER]` blocks with your own content. Or:

```bash
claude "Open strategy.template.md, save a copy as linkedin-strategy.md, and help me fill it in by asking me questions one at a time."
```

### Step B7. Run your first brief

```bash
claude "linkedin brief"
```

Claude Code runs the skill, calls the LinkedIn MCP, reads your strategy and any notes you point it at, and updates the engagement console JSON block.

### Step B8. Open the console

```bash
# Mac
open index.html

# Windows
start index.html

# Linux
xdg-open index.html
```

The console opens in your default browser. Same three-column layout as Track A.

### Step B9. Schedule the daily run (optional)

Use your operating system's scheduler.

**Mac/Linux: cron.** Open your crontab with `crontab -e` and add a line like:

```
0 9 * * 1-5 cd /path/to/tinkering/linkedin-engagement-console && claude "linkedin brief" >> daily.log 2>&1
```

**Windows: Task Scheduler.** Create a Basic Task, set it to run daily at 9am weekdays, action: run `claude "linkedin brief"` from the linkedin-engagement-console folder.

---

## Customization

After setup, the most useful things to tweak.

### Change the four lenses

The console ships with four lenses: `biotech`, `ai_builder`, `operator`, `vc`. If your work does not fit those, rename them.

1. Open `index.html`. In the `PERSONA.lensPostures` block, rename the keys (for example `biotech` becomes `b2b_saas`).
2. In the same file, find the CSS block. Change the `.lens.biotech` rule to `.lens.b2b_saas` and update the color if you want.
3. In `linkedin-strategy.md`, rename the lens sections to match.

Or ask Claude:

```
In tinkering/linkedin-engagement-console/index.html and tinkering/linkedin-engagement-console/linkedin-strategy.md, rename the lens "biotech" to "[your new lens name]" everywhere. Update the lens chip color in the CSS to [color name or hex]. Keep everything else the same.
```

### Change the LinkedIn brand colors

The whole console uses LinkedIn's palette by default. If you want a different look, edit the `--li-*` CSS variables at the top of `index.html`. Pick any palette you like.

### Change comment length

In the `PERSONA` block, change `commentLength` from `"1 to 3 sentences"` to your preference. Same for `postLength`.

### Add a new column

The grid is three columns. Add a fourth by editing the `.cols` CSS rule and copying one of the existing column blocks. If this sounds intimidating, ask Claude to do it.

### Add your own MCP

The skill template assumes one LinkedIn MCP. If you want to add Gmail, Slack, or your notes app, install the relevant MCP and add a line to your `.mcp.json` (Track B) or wire it up in Cowork settings (Track A). Then edit `skill.template.md` to call the new MCP at the right step.

---

## Troubleshooting

**The console says "Loading..." and never shows anything.**

The JSON block is malformed. Open `index.html` in a text editor, find `<script type="application/json" id="briefing-data">`, and check that the JSON between that tag and `</script>` is valid. Easiest fix: copy the contents of `examples/example-data.json` over the broken block.

**The drafts sound generic, nothing like me.**

Two likely causes.

1. You did not fill in `linkedin-strategy.md`. The placeholders are still there. Open it, replace them with real content.
2. You did not point the skill at your own notes. The skill works best when it can read what you actually did this week. In Cowork, add your notes folder to the workspace. In Claude Code, edit `~/.claude/skills/linkedin-engage/SKILL.md` and update Step 3 to point at your notes path.

**I see em-dashes in the drafts (the long dash, like this: —).**

The LLM ignored your voice rules. Open `index.html`, find the `voiceRules` array in PERSONA, and add this line if it is missing:

```
"No em-dashes. Use periods or commas instead.",
```

**The LinkedIn MCP says "session expired" or "login failed".**

Your LinkedIn session cookie expired. Re-run the LinkedIn MCP's login flow. The upstream README has the command.

**Claude Code says "skill not found".**

Check that the file is at `~/.claude/skills/linkedin-engage/SKILL.md` (Mac/Linux) or `%USERPROFILE%\.claude\skills\linkedin-engage\SKILL.md` (Windows). The folder name and the file name both matter.

**Cowork does not see my MCP.**

Restart Cowork after adding the MCP. The connector list refreshes on app start.

**The "Open in LinkedIn (copies)" button does not copy.**

Some sandboxed iframes block the clipboard. The console falls back to highlighting the draft text so you can press Ctrl+C manually. Watch for the blue outline that appears around the draft after you click the button.

**I do not want LinkedIn to know I am using an automated tool.**

The LinkedIn MCP uses Patchright, which is a stealth-mode browser. It looks like a normal Chrome session to LinkedIn. The daily-budget defaults in `linkedin-strategy.md` (5 comments proposed, 3 sent, 3 connects) are well below LinkedIn's anti-automation thresholds. If you ever see a "you are doing this too much" warning from LinkedIn, halve every number in the budget table for a week and you will be fine.

---

## FAQ

**Is this free?**

The console code is free (MIT license). You will pay for your Claude subscription separately. The LinkedIn MCP is also free (Apache 2.0). No other costs.

**Does this post for me automatically?**

No. The console drafts. You approve and send. Posting automatically is a different feature you would have to build yourself, and it is also more likely to get flagged by LinkedIn.

**Can my LinkedIn account get banned?**

If you stay under the daily budget defaults (5 comments proposed, 3 sent, 3 connects per day), the risk is very low. LinkedIn's anti-automation systems flag behavior that does not look human (hundreds of actions per hour, no scrolling, no profile views). This tool runs once a day, proposes a handful of actions, and lets you do the actual posting in the LinkedIn UI yourself.

**Can I share my customized version?**

Yes, the MIT license lets you fork. If you do something interesting, open an issue on the [tinkering repo](https://github.com/till-hohmann/tinkering) with a link.

**Does this work with X (Twitter)?**

Not yet. The architecture would port (the same chat-fetches-artifact-displays pattern works for any social platform with an MCP), but you would need an X MCP server. If you build one, ping me.

**Does this work with notes apps other than Obsidian?**

Yes. The skill template's Step 3 just says "read your recent notes". Any folder with markdown files works. Notion, Apple Notes, and similar require their own MCPs.

---

## Where to get help

- For console bugs: open an issue at [github.com/till-hohmann/tinkering](https://github.com/till-hohmann/tinkering).
- For LinkedIn MCP issues: open an issue at [github.com/stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server).
- For Claude Cowork or Claude Code issues: see Anthropic's docs at [docs.claude.com](https://docs.claude.com).
