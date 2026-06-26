# Adding Content

Use this checklist when adding a new learning module or page.

## Page Setup

1. Add the Astro or MDX page under `src/pages`.
2. Use `TextbookLayout.astro` for normal lesson pages.
3. Use `BaseLayout.astro` directly for the home page or pages with custom structure.
4. Use `ImmersiveLayout.astro` only for full-screen tools that should not show the standard nav.

## Metadata And Navigation

Register public learning pages in `src/data/modules/` (one file per domain, assembled by `src/data/modules/index.ts`):

- Add or update the module entry in its domain file.
- Add the page entry with `href`, `title`, `description`, and `seo`.
- Set `canonicalPath` to the route path without a trailing slash, except `/`.
- Use `noindex: true` only for hidden experiments or pages that should not appear in search.

Top-level site defaults live in `src/data/site.ts`. Do not duplicate titles, descriptions, social image defaults, or canonical handling in individual layouts.

Navigation is derived from module groups in `src/data/modules/` and `src/data/navigation.ts`. Prefer adding a page to an existing group before inventing a new navigation section.

## Content Conventions

- Preserve the visual direction in [Design Baseline](design-baseline.md), especially the quiet textbook layout and compact navigation.
- Keep explanatory content in MDX when possible.
- Use reusable textbook components for derivations, worked examples, problem-solving sections, and checkpoint questions.
- Keep page-specific copy in the page file, but move reusable interactive behavior into a component.
- Prefer existing social images until a module needs its own specific card.

## Verification

For a content-only change, run:

```sh
npm run build
```

For a content change with simulation or scoring behavior, also run the relevant domain test script or `npm run test:all`.
