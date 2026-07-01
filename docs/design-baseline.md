# Design Baseline

The published site at `https://physicsnook.com` is the visual source of truth. Use this note to keep future cleanup, content, and agent work from drifting away from the current design.

## Current Shape

- Homepage: a single-screen immersive entry with the fixed compact nav, animated wave-field background, soft atmospheric light, and three large module cards anchored near the bottom.
- Navigation: white/light surface by default, compact brand text, `Interactives` and `Resources` primary links, a search icon opening a command-palette search, circular theme toggle, and icon-only mobile menu.
- Lesson pages: quiet textbook reading surfaces with generous top air, a wide module-path navigator, black-outlined cards, restrained blue active states, and prose in a centered column.
- Interactives page: dense catalog layout, compact filters, grouped rows, small tags, and minimal explanatory copy.
- Resources page: quiet intro copy, a module card grid, and grouped external links — no dropdown menu, just one page.
- Mobile: stacked module cards, compact header controls, no horizontal page overflow, and readable card/prose rhythm.

## Guardrails

- Do not replace the homepage with a marketing landing page or add explanatory hero copy unless the product direction changes.
- Do not restyle lesson pages into card-heavy dashboards; preserve the quiet textbook cadence.
- Prefer existing theme tokens from `src/styles/global.css` and Tailwind `theme-*` aliases.
- Keep reusable visual changes in shared layout/component files instead of copying one-off styles through MDX pages.
- For visual changes, smoke-test `/`, `/interactives`, `/resources`, `/math/vectors`, and `/oscillations` at desktop and mobile widths.
