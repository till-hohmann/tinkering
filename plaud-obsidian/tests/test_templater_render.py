"""Tests for the block renderer."""

import datetime as dt

from plaud_obsidian.common.config import (
    Correction,
    TemplateInclude,
    TemplateSpec,
)
from plaud_obsidian.common.indices import Index
from plaud_obsidian.templater.render import (
    render_block,
    warn_missing_categories,
)


def _ix(id_, **cats):
    idx = Index(id=id_, path=None, categories={})
    for name, values in cats.items():
        idx.categories[name] = list(values)
    return idx


def test_render_pulls_categories_in_order():
    spec = TemplateSpec(id="t", include=[
        TemplateInclude(index="people", categories=["Team", "External"]),
    ])
    indices = {
        "people": _ix("people", Team=["Anna", "Bob"], External=["Dilan"]),
    }
    out = render_block(spec, indices, [], today=dt.date(2026, 5, 24))
    assert "<!-- generated 2026-05-24 by plaud-obsidian templater -->" in out
    # Team comes before External (order preserved).
    assert out.index("### People — Team") < out.index("### People — External")
    assert "- [[Anna]]" in out
    assert "- [[Bob]]" in out
    assert "- [[Dilan]]" in out


def test_render_wildcard_includes_all_categories():
    spec = TemplateSpec(id="t", include=[
        TemplateInclude(index="people", categories="*"),
    ])
    indices = {"people": _ix("people", A=["x"], B=["y"], C=["z"])}
    out = render_block(spec, indices, [])
    assert "### People — A" in out
    assert "### People — B" in out
    assert "### People — C" in out


def test_render_skips_unknown_index():
    spec = TemplateSpec(id="t", include=[
        TemplateInclude(index="missing", categories="*"),
    ])
    out = render_block(spec, {}, [])
    # No section headings, just the generation comment + blanks.
    assert "###" not in out
    assert "generated" in out


def test_render_applies_corrections():
    spec = TemplateSpec(id="t", include=[
        TemplateInclude(index="people", categories="*"),
    ])
    indices = {"people": _ix("people", Team=["ACME"])}
    out = render_block(spec, indices, [Correction(from_="ACME", to="Acme Corp")])
    assert "[[Acme Corp]]" in out
    assert "[[ACME]]" not in out


def test_render_skips_empty_categories():
    spec = TemplateSpec(id="t", include=[
        TemplateInclude(index="people", categories=["Empty", "Real"]),
    ])
    indices = {"people": _ix("people", Empty=[], Real=["a"])}
    out = render_block(spec, indices, [])
    assert "### People — Empty" not in out
    assert "### People — Real" in out


def test_warn_missing_categories_flags_typos():
    spec = TemplateSpec(id="t", include=[
        TemplateInclude(index="people", categories=["Teem", "Real"]),
    ])
    indices = {"people": _ix("people", Team=["a"], Real=["b"])}
    warnings = warn_missing_categories(spec, indices)
    # Exactly one warning, and it's about 'Teem' specifically. The warning
    # body may mention 'Real' as one of the available alternatives, so we
    # check the specific quoted form 'category \'Teem\''.
    assert len(warnings) == 1
    assert "category 'Teem'" in warnings[0]
    assert "category 'Real'" not in warnings[0]


def test_warn_missing_categories_flags_unknown_index():
    spec = TemplateSpec(id="t", include=[
        TemplateInclude(index="ghost", categories="*"),
    ])
    warnings = warn_missing_categories(spec, {})
    assert any("ghost" in w for w in warnings)
