# LinkedIn Strategy Template

> Drives the daily LinkedIn engagement pass. Defines who you want to engage with, what counts as worth commenting on, what your own posts should sound like, and what to filter out.

Fill in the `[PLACEHOLDER]` sections. Delete sections that do not apply. This file is the single source of truth your orchestration skill loads at every pass.

---

## Positioning

One or two sentences. Who are you, what is the operator narrative, what should a reader think when they see a post or comment from you?

Example: *"COO of a B2B SaaS scale-up, technologist by background. Posts about real operating reality, not motivational content."*

[PLACEHOLDER: write your positioning here]

The test for any post or comment: would [a specific trusted peer] read this and think "yes, that's [you]"?

[PLACEHOLDER: name the peer whose taste you trust]

---

## The engagement lenses

Each post and profile is tagged with one or more lens. Off-lens content gets skipped.

The defaults below are sized for an operator who builds. Rename, replace, or delete lenses to match your own engagement scope. The keys are referenced from `index.html` (PERSONA.lensPostures) so keep the kebab-case names in sync.

### 1. biotech (rename to your domain)

- **What's in:** [your sector's substantive content]
- **What's out:** [hype, press releases, motivational]
- **Personas to engage with:** [founder type, role type, ecosystem voice]
- **People to follow / connect:**
  - [PLACEHOLDER: name, role, why they matter]
  - [PLACEHOLDER: name, role, why]
  - [PLACEHOLDER: name, role, why]

### 2. ai_builder

- **What's in:** real builders working with agents, MCP, real-world AI deployments. Tooling that solves an actual workflow. Postmortems of failures. Honest cost / latency / quality trade-offs.
- **What's out:** "10 prompts that will change your life", LinkedIn-influencer AI gurus.
- **Personas to engage with:** people shipping agent tooling for a living, founders who've integrated AI into a non-tech operational business.
- **People to follow / connect:**
  - [PLACEHOLDER: name, why]
  - [PLACEHOLDER: name, why]

### 3. operator

- **What's in:** operator content from people running real businesses. Hiring, org design under constraint, board management, fundraising mechanics, the daily reality of a #2 role.
- **What's out:** generic "leadership tips", career-advice content, founder-influencer self-promotion.
- **Personas to engage with:** other operators in similar role + stage, CEOs who write candidly.
- **People to follow / connect:**
  - [PLACEHOLDER: name, why]

### 4. vc (or your region/sector investor lens)

- **What's in:** investors who post substantively, policy voices, peer founders in your geography.
- **What's out:** generic "Europe vs US" rants, deal-announcement spam.
- **Personas to engage with:** investors in your domain who write essays, not press releases.
- **People to follow / connect:**
  - [PLACEHOLDER: name, why]

---

## Target companies

The peer-company set that the orchestration skill scrapes via `linkedin__get_company_posts` on every run. One slug per line. Keep the slug list in the strategy file, not in the skill body, so adding a new peer takes one YAML edit and no skill rebuild.

```yaml
target_companies:
  - slug: example-company-a
    name: Example Company A
    lens: biotech
  - slug: example-company-b
    name: Example Company B
    lens: biotech
    note: company page often empty; track <Founder Name> personal feed instead
  - slug: example-company-c
    name: Example Company C
    lens: biotech
```

**Persona-to-company collapse rules** (used by the cadence guard). Each company groups with its named employees; engagement with any of them counts toward the same cadence key. Without this, the cadence guard is trivially circumventable: 3 posts from a company plus 1 from an employee reads as "different authors" rather than "4 touches on the same peer". Maintain this list as new peers join the strategy.

```yaml
company_employee_map:
  example-company-a: [<Founder Name>, <COO Name>, <Head of R&D>]
  example-company-b: [<Founder Name>]
  example-company-c: [<CEO Name>, <CCO Name>]
```

**Notes for adding a new peer:**

- Add the slug to `target_companies`. The skill picks it up on the next run.
- Add the company + at least one known employee name to `company_employee_map` so cadence collapse works from day one.
- If the company page is dormant, set `note:` accordingly and consider scraping a key personal profile instead.

---

## Skip patterns

Cut the noise before scoring runs.

- AI-slop posts ("I asked ChatGPT to do X and here's what happened...")
- Motivational quote posts with a stock photo
- "Founders, here are 5 lessons I learned..." listicles with no specifics
- Hiring posts unless directly relevant
- Engagement-bait formats: polls with no real question, "agree?" closers
- [PLACEHOLDER: add company names or topics you have decided not to engage with publicly]

---

## Comment posture per lens

The comment is in your voice. Adds, never agrees.

- **[lens 1] posture:** add a concrete number, a counterexample from your own experience, or a sharp question about unit economics. Never a thumbs-up restated as prose.
- **ai_builder posture:** add a specific build detail from your own work. Reference a real tool by name. "We tried this with MCP X, the failure mode was Y" only if true.
- **operator posture:** ground abstract content with operational specifics. Comment as someone who has done it, not as a coach.
- **vc posture:** add a data point or specific company / policy reference. Do not tribally agree.

**Length:** 1 to 3 sentences. No emojis. No exclamation marks. Open with substance.

---

## Connection note posture

When sending a connect with a note, keep it short and grounded in a specific reason.

- **Good:** "Saw your post on [specific thing] last week. The [specific detail] was useful. We're using a similar pattern for [your context]. Worth being connected."
- **Bad:** "Hi! I'd love to connect and learn from your journey." (Empty.)
- **Bad:** "I think there's potential synergy." (Buzzword stack.)

**Default to "follow only"** for cold profiles where there's no specific connection reason yet. Connecting comes after 1-2 substantive comments.

---

## Own-content posture

When proposing post ideas, anchor in something you actually did this week. Sources: your own notes, journal entries, meeting summaries, decisions logged. **Never invent activity.**

- **[Domain] angle:** a specific lesson from running [your business] this week. A trade-off named, a number cited, a real partner mentioned (only when comms-cleared).
- **Builder angle:** something you shipped this week with [your tooling stack]. A real failure you debugged. A pattern that worked. Always with the tool name.
- **Hybrid angle:** where your two worlds meet. Often the highest-value posts.

**Cadence target:** 1 to 2 own posts per week. Quality over volume. A post should leave a reader with one concrete thing they didn't know.

---

## Confidentiality rules

Lists what is off-limits in every public output. The orchestration skill enforces this.

- [PLACEHOLDER: never post specifics about partner / customer X]
- [PLACEHOLDER: investor names only with prior approval]
- [PLACEHOLDER: any confidential projects, codenames, or commercial terms]
- Default: assume confidential, ask if in doubt.

---

## Daily budget (rate limits)

Upper bounds, not targets. These keep you well under LinkedIn anti-bot thresholds.

| Action                 | Max / day | Notes                                                                 |
| ---------------------- | --------- | --------------------------------------------------------------------- |
| Posts read (feed)      | 50        | Scroll budget for the morning scrape                                  |
| Posts read (search)    | 30        | Across all lenses                                                     |
| Comments proposed      | 5         | Top of the queue, not "every interesting post"                        |
| Comments actually sent | 3         | You approve and submit                                                |
| Connect requests sent  | 3         | With personalised notes. Generic connects = 0                         |
| Follows                | 5         | Lower friction than connects                                          |

If LinkedIn shows any "you're doing this too much" warning, halve all numbers for a week.

---

## Review

Re-read this file monthly. If a lens isn't producing useful signal, narrow or replace it. If a persona list is generating spam-grade matches, tighten it. If the comment-posture rules aren't producing comments you'd actually send, rewrite them with the failure case as input.

[PLACEHOLDER = needs your input. Fill in as you go; everything else will work in the meantime.]
