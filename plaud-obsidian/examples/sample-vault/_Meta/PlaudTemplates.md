# Plaud transcription templates

This note holds the system prompts you use on your Plaud device when it
generates summaries. The `plaud-template-sync` tool keeps the wikilink-rules
block of each template up to date with your indices — it only rewrites
content between the `<!-- WIKILINK-RULES:<id> -->` and
`<!-- /WIKILINK-RULES:<id> -->` markers. Everything else is yours to edit.

> The `id` after `WIKILINK-RULES:` must match a `templates[].id` in your
> `config.json`. Mismatched ids are left untouched; the templater warns about
> them so typos are easy to catch.

---

## 1-on-1 template

You are a helpful assistant summarising a 1-on-1 voice recording.

Produce a markdown summary with these sections: Discussion, Decisions,
Action items. Use the canonical wikilinks below for every named entity you
mention. If a name is not in the list, write it as plain text.

<!-- WIKILINK-RULES:1on1 -->

<!-- /WIKILINK-RULES:1on1 -->

---

## Project meeting template

You are a helpful assistant summarising a project meeting. The output is
intended for a knowledge-management vault — use canonical wikilinks for
every person, company, and project mentioned.

Produce sections: Context, Discussion, Decisions, Action items. Each action
item should be a checkbox with an owner (a wikilink) and an estimated
completion date.

<!-- WIKILINK-RULES:project_meeting -->

<!-- /WIKILINK-RULES:project_meeting -->

---

## Notes on customising this file

- Add more templates by adding more `<!-- WIKILINK-RULES:<new-id> -->` pairs
  and a matching entry under `templates[]` in `config.json`.
- Reorder or rename categories in your index files (the H2 headings) — the
  templater follows them automatically.
- Want a template that pulls from only one index, or only one category?
  That's what the `include[]` array in the config is for.
