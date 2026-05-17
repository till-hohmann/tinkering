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
2. `linkedin__get_company_posts` for each peer company listed in your strategy

If any company call fails, note the gap in the brief's Caveats section and continue.

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

1. Drop if matches a skip pattern or is off-lens.
2. Classify by lens.
3. Score 0-100. Higher for: peer-tier author, names you or your company, recent (last 7 days), opens real debate, **AND grounding feedstock supports a real comment**.
4. For top-5: draft a 1-3 sentence comment following lens posture, **grounded in Step 3 feedstock**. Each comment MUST cite at least one real fact from your recent activity - a specific number, a peer-company move, a real decision, or a named conversation.

**Quality bar:** if a draft sounds like generic operator-speak ("real partner deals replacing pilot grants", "the trough filters quality"), it is too abstract. Rewrite with a specific number or specific peer-name from Step 3, or drop it.

**Engage targets:** 3 high-scoring profiles with a one-line "why now".

**Post ideas:** 1-2 angles **grounded in Step 3 feedstock**. Each needs angle name, hook line in your voice referencing real recent activity, supporting paragraph. Never invent activity.

## Step 5 - Build the JSON payload

Shape must match the artifact's `briefing-data` block exactly. See `examples/example-data.json` for the canonical structure.

```json
{
  "generated_at": "<ISO8601>",
  "posts_scanned": <int>,
  "comments": [
    { "url": "...", "author": "...", "company": "..." or null, "lens": "biotech|ai_builder|operator|vc", "score": <int>, "why": "...", "draft": "..." }
  ],
  "engage": [
    { "name": "...", "profile_hint": "<slug or empty>", "reason": "...", "lens": "..." }
  ],
  "post_ideas": [
    { "angle": "...", "hook": "...", "supporting": "..." }
  ]
}
```

## Step 6 - Update the artifact

Replace the contents of the `<script type="application/json" id="briefing-data">...</script>` block in `index.html` with your new JSON. Save and re-open the artifact.

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
