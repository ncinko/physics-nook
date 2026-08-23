# Adding Content

Use this checklist when adding a new learning module or page.

## Page Setup

1. Start from `docs/templates/lesson-page.mdx.template` — copy it to `src/pages/<domain>/<page-slug>.mdx` and fill in the placeholders, rather than reverse-engineering the pattern from an existing page. It mirrors the current best example, `src/pages/astronomy/orbits.mdx`.
2. Use `TextbookLayout.astro` for normal lesson pages (the template already sets this).
3. Use `BaseLayout.astro` directly for the home page or pages with custom structure.
4. Use `ImmersiveLayout.astro` only for full-screen tools that should not show the standard nav.

## Metadata And Navigation

Register public learning pages in `src/data/modules/` (one file per domain, assembled by `src/data/modules/index.ts`). Follow `docs/templates/module-entry.md` for the exact shape of the page entry and any interactive catalog entries:

- Add or update the module entry in its domain file.
- Add the page entry with `href`, `title`, `description`, and `seo`.
- Set `canonicalPath` to the route path without a trailing slash, except `/`.
- Use `noindex: true` only for hidden experiments or pages that should not appear in search.

Top-level site defaults live in `src/data/site.ts`. Do not duplicate titles, descriptions, social image defaults, or canonical handling in individual layouts.

Navigation is derived from module groups in `src/data/modules/` and `src/data/navigation.ts`. Prefer adding a page to an existing group before inventing a new navigation section. Every page registered here also becomes searchable in the site search palette (`src/data/searchIndex.ts` reads from the same module data) and appears in `sitemap.xml` — no separate registration needed for either.

## Content Conventions

- Preserve the visual direction in [Design Baseline](design-baseline.md), especially the quiet textbook layout and compact navigation.
- Keep explanatory content in MDX when possible.
- Use reusable textbook components for derivations, worked examples, problem-solving sections, and checkpoint questions.
- Keep page-specific copy in the page file, but move reusable interactive behavior into a component.
- Prefer existing social images until a module needs its own specific card.

## Prose & Math Conventions

Match the voice already established in pages like `src/pages/astronomy/orbits.mdx`:

- Open each page or major section with plain-language framing of the phenomenon or
  question before introducing formalism.
- Bold **key terms** the first time they're defined; do not bold for emphasis elsewhere.
- Cross-reference earlier ideas by name ("the same two-frame thinking explains...")
  instead of re-explaining setup from scratch.
- In KaTeX, wrap units in `\text{}` (e.g. `\left(\frac{T}{\text{yr}}\right)^2`), and
  prefer a `$$` display block for the equation being introduced or used, with the
  narrative sentence around it in prose rather than inside the math.
- To explain notation the first time it appears without adding a visible paragraph,
  tag that part of the equation with `\htmlClass{math-hint math-hint-<id>}{...}` and add a
  matching `<MathHint id="<id>" label="...">` block right after the `$$` display. The
  explanation shows in a hover/tap popup and stays in the DOM for screen readers; the
  rendered equation is unchanged. Reuse one id for every symbol sharing an explanation.
- Worked examples (`WorkedExampleCard`) use `#### Problem`, `#### Use`, `#### Solve`,
  `#### Check` as sub-headings, in that order; `Check` is one sentence sanity-checking
  the magnitude, direction, or a limiting case of the result.
- Checkpoint questions (`QuestionSequence`) give every option — including the correct
  one — a short explanation, since that's what the reader sees after answering, not
  just a right/wrong flag. Keep incorrect options plausible, not silly.

## Verification

For a content-only change, run:

```sh
npm run build
```

For a content change with simulation or scoring behavior, also run the relevant domain test script or `npm run test:all`.
