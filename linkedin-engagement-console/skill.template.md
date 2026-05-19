---
name: linkedin-engage
description: Runs your daily LinkedIn engagement pass. Pulls feed + peer-company posts via the LinkedIn MCP, scores against your strategy file with voice + anti-pattern enforcement, drafts comments grounded in your own recent activity, surfaces profiles to engage with, proposes own-content angles. Updates the linkedin-engagement-console artifact with freshly-baked JSON data. Use when you say "linkedin brief", "linkedin pass", "scan linkedin", or any variation.
---

# LinkedIn Engagement Brief Skill

This is the orchestration template that drives the engagement console. The skill runs in chat (where MCP tools work), bakes the result into the artifact's JSON data block, and writes an optional markdown brief to your notes system.

## Important architecture note

LinkedIn MCP tools are called from **chat**, never from the artifact's JavaScript context. The artifact is a viewer that renders the JSON you embed via `update_artifact`. This pattern is called "chat-fetches-artifact-displays". See README.md for the reasoning.

## Step 1 - Load context (mandatory, in order)

Adjust paths to wherever you keep your context files. The defaults below assume the conventions from this template.

1. `identity.md` - who you are, your role, your strategic priorities
2. `voice.md` - how you write
3. `anti-patterns.md` - what to never produce in your outputs
4. `linkedin-strategy.md` - lenses, personas, skip patterns, confidentiality rules

Voice rules that must be enforced in every comment and post idea:

- Short sentences. Concrete nouns. Real names and real numbers.
- No em-dashes. Near-zero, not "up to two".
- No AI-tells: "delve", "dive deep", "leverage" (verb), "unlock", "synergy", "seamless", "elevate", "journey", "ecosystem" as cliche.
- No "Great post", "Thanks for sharing", "Absolutely". No thumbs-up restated as prose.
- No exclamation marks. No emojis. Open with substance.

Lens postures come from your `linkedin-strategy.md`.

## Step 2 - Pull LinkedIn data

Call these in parallel:

1. `linkedin__get_feed` with `num_posts: 40`
2. `linkedin__get_company_posts` for each slug listed in the `## Target companies` block of your `linkedin-strategy.md`. The strategy file is the source of truth; do not hardcode the slug list here.

If any company call fails, note the gap in the brief's Caveats section and continue.

### Handling oversize responses

`get_feed` and `get_company_posts` for active companies routinely return responses that exceed the per-tool-call token cap. When that happens the MCP saves the full result to a file and returns the file path plus a note.

**Do not silently skip oversize responses.** Read the saved file in chunks until 100% of the content has been parsed. For each chunk, extract per-post records: author, posted_at (resolve relative ages like "6d" / "3w" / "12h" to absolute hours), body preview, lens classification. Dedupe by post URL or by author + first 80 chars of body. The Caveats section MUST list whether each oversize response was fully parsed or only partially.

## Step 2b - Pull your own LinkedIn activity (outcome loop)

In the same parallel batch as Step 2, call `linkedin__get_my_profile` with `sections: ['posts']`.

Filter to posts published in the last 7 days. For each, capture: `url`, `posted_at`, `text_preview` (first 100 chars), `reactions`, `comments`, `reshares`, `top_commenter`.

Build `own_posts_last_week` array (newest first) and derive `posts_published_this_week` (count of own posts where `posted_at >= start_of_current_ISO_week`). The artifact's results strip renders these against `weekly_post_target`.

If the MCP returns no posts or fails, set `own_posts_last_week: []` and `posts_published_this_week: 0`. Never fabricate own-post data.

## Step 2c - Build per-author cadence (anti-spam guard)

After Step 2 and 2b complete, scan prior briefs to compute how often each peer has appeared in the proposed-comments list lately. This prevents the console from nudging you to comment on the same five peers every day.

1. Glob your `*_engagement_brief.md` (or equivalent) files.
2. Keep only those within the last 14 days. **Exclude today's brief if you are about to overwrite it** so a re-run does not count its own previous version.
3. Parse the "Comments to make" section of each and extract the `author` of each card.
4. Build `author_cadence_14d`: a dict of `{ "<author_display_name>": <count>, ... }`.
5. **Normalise author names with a two-pass rule.** First pass: lower-case and strip parenthetical suffixes. Second pass: collapse company + known-employee authors to the same key, using the `company_employee_map` block in `linkedin-strategy.md` as the source of truth. Without this, the cadence guard is trivially circumventable.
6. Emit the most-recent display form back in `author_cadence_14d`. The per-comment `author_cadence_14d` lookup uses the normalised key.

If no prior briefs exist, return `author_cadence_14d: {}` and continue.

## Step 3 - REQUIRED: Pull grounding feedstock (do NOT skip)

**This step is mandatory.** Without it, draft comments and post ideas are abstract operator-speak that doesn't sound like you. Skipping this step produces fabricated content - invented numbers, made-up decisions, generic platitudes. This is the single biggest quality failure mode.

Read these sources covering the last 14 days:

1. **Your weekly notes / journal** - the densest signal source. Board decisions, partner moves, peer-company news you've tracked, named conversations. Always read at least the latest one in full.
2. **Your meeting notes** - especially anything recent with internal team, customers, or partners.
3. **Your voice memos / inbox** - operational substance from the field.
4. **People notes** for any peer the brief might reference.

Extract concretely:

- **Real numbers** you could cite
- **Real decisions** you made or witnessed
- **Real peer-company moves** you tracked
- **Real named people** you engaged with (only those safe to mention publicly per the strategy's confidentiality rules)

**Anti-fabrication test:** before writing any comment draft in Step 4, ask:

> "Is there a real number, real decision, or real peer move from this week's feedstock that grounds this comment?"

If no, the comment is too abstract. Drop the post or pick a different angle.

## Step 4 - Score, classify, draft

For each post:

1. Drop if matches a skip pattern or is off-lens. **Increment the matching bucket** in `filtered_summary` (see Step 5) so the artifact can render filter transparency.
2. Classify by lens.
3. Score 0-100. Higher for: peer-tier author, names you or your company, recent (last 7 days), opens real debate, **AND grounding feedstock supports a real comment**.
4. **Apply freshness decay.** Compute `age_hours` from the post timestamp. Multiply the raw score by:
   - 1.00 if `age_hours <= 72`
   - 0.70 if `72 < age_hours <= 120`
   - 0.50 if `120 < age_hours <= 168`
   - drop the post entirely if `age_hours > 168` (bucket as `too_old` in `filtered_summary`)
   Round to int. Capture `age_hours` on the comment object so the artifact can show it.
5. **Apply cadence penalty.** Look up the post's normalised author in `author_cadence_14d` (from Step 2c). Multiply the decayed score by:
   - 1.00 if cadence count `0` or `1`
   - 0.60 if count `2`
   - 0.30 if count `3`
   - drop the post entirely if count `>= 4` (suppression, not filtering)
   Round to int. Capture the count on the comment object as `author_cadence_14d`.
6. For top-5 by final (decay × cadence) score: draft a 1-3 sentence comment following lens posture, **grounded in Step 3 feedstock**. Each comment MUST cite at least one real fact from your recent activity.

**Quality bar:** if a draft sounds like generic operator-speak, it is too abstract. Rewrite with a specific number or specific peer-name from Step 3, or drop it.

**Engage targets:** **5 high-scoring profiles** with a one-line "why now" plus a drafted `connect_note`. The artifact filters out targets you have skipped in prior sessions, so emitting 5 leaves a useful queue after typical churn.

**Connect-note drafting rules.** Each Engage card gets a `connect_note` field: a 1-2 sentence note you could paste into a LinkedIn connection request. Same voice rules as comments. Anchor on a specific reason to connect, ideally referencing a recent post the target made or a shared context grounded in your feedstock. Never empty. Never buzzword stack. If the target is a "follow-only" recommendation (cold profile, no specific connection reason yet), emit `connect_note: ""` and surface that in the Engage rationale.

**Post ideas:** 1-2 angles **grounded in Step 3 feedstock**. Each needs angle name, hook line in your voice referencing real recent activity, supporting paragraph. Never invent activity.

## Step 5 - Build the JSON payload

Shape must match the artifact's `briefing-data` block exactly. See `examples/example-data.json` for the canonical structure.

```json
{
  "generated_at": "<iso8601>",
  "posts_scanned": <int>,
  "filtered_summary": {
    "ai_slop": <int>,
    "off_lens": <int>,
    "motivational": <int>,
    "engagement_bait": <int>,
    "too_old": <int>,
    "skip_list_match": <int>,
    "own_post": <int>
  },
  "grounding_sources": ["path/to/weekly_learnings.md", "path/to/meeting_prep.md"],
  "posts_published_this_week": <int>,
  "weekly_post_target": 2,
  "own_posts_last_week": [
    {
      "url": "...",
      "posted_at": "<iso8601>",
      "text_preview": "<first 100 chars>",
      "reactions": <int>,
      "comments": <int>,
      "reshares": <int>,
      "top_commenter": "<name or null>"
    }
  ],
  "author_cadence_14d": { "Example Company A": 2, "Example Company B": 1 },
  "comments": [
    { "url": "...", "author": "...", "company": "..." or null, "lens": "biotech|ai_builder|operator|vc", "score": <int>, "age_hours": <int>, "author_cadence_14d": <int>, "why": "...", "draft": "..." }
  ],
  "engage": [
    { "name": "...", "profile_hint": "<slug>", "reason": "...", "lens": "...", "connect_note": "..." }
  ],
  "post_ideas": [
    { "angle": "...", "hook": "...", "supporting": "..." }
  ]
}
```

Field notes:

- `filtered_summary`: counts of posts dropped per skip reason during Step 4. Drives the artifact's audit strip.
- `grounding_sources`: list of files you read during Step 3. Surfaced in the audit strip so the anti-fabrication step is auditable at a glance.
- `posts_published_this_week`: derived in Step 2b, not hardcoded.
- `own_posts_last_week`: array of your own recent posts with engagement numbers. Drives the "Last week" results strip. Empty array is valid.
- `author_cadence_14d`: dict of `{ author_display_name: count }` from Step 2c. Skill uses it for scoring penalty; artifact uses it to render a warning badge on comment cards.
- `age_hours`: integer hours since the source post was published. Decayed score already factors this in; artifact uses it for the "12h ago" tag.
- `connect_note`: drafted note for the LinkedIn connection request. Empty string is valid for follow-only recommendations.

## Step 6 - Update the artifact

Replace the contents of the `<script type="application/json" id="briefing-data">...</script>` block in `index.html` with your new JSON. Save and re-open the artifact.

**Robust redeploy.** If you are updating only the UI of `index.html` (CSS, layout, button behavior) without a fresh data scrape, **preserve the existing `briefing-data` block** from the deployed file. Resetting to the empty template wipes the latest live brief data.

For chat-side automation pipelines that deploy via an artifact API, validate before deploying: file ends in `</html>`, the JSON parses, the inline JS syntax-checks. Most "Loading..." failure modes come from a truncated upload.

## Step 7 - Write the optional markdown brief

Sections in order: Comments to make / People to engage with / Post ideas / Gaps and caveats.

In the Caveats section, note which feedstock files you read so future runs can see the grounding source.

## Anti-fabrication rules (mandatory)

- **Never invent a number, decision, or peer move that does not appear in Step 3 feedstock.** If a comment needs a specific number you don't have, drop the comment.
- Never invent a post that didn't appear in the scrape.
- Never put words in a peer's mouth when summarizing their post.
- Never propose engaging with internal team members.
- Never propose a post touching confidential partners, codenames, or commercial terms (per your strategy file).
- If the LinkedIn MCP is unavailable, write a minimal note saying so. Do not fabricate a brief.

## Daily budget enforcement

From strategy file: feed 50, search 30, comments 5, connects 3, follows 5. The skill proposes; you approve.
