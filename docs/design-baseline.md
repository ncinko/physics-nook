# Design Baseline

The published site at `https://physicsnook.com` is the visual source of truth. Use this note to keep future cleanup, content, and agent work from drifting away from the current design.

## Current Shape

- Homepage: a single-screen immersive entry with the fixed compact nav, animated wave-field background, soft atmospheric light, and three large module cards anchored near the bottom.
- Navigation: warm ivory Paper surface by default, compact brand text, `Interactives` and `Resources` primary links, a search icon opening a command-palette search, three-segment circular theme button, and icon-only mobile menu.
- Themes: Paper is the default for visitors without a saved preference; the button cycles Light → Dark → Paper. Paper uses warm ivory surfaces and charcoal text for reading, with the same layout and simulation color meanings. The selected wedge has a checkmark, and the user's chosen theme persists across pages and future visits.
- Lesson pages: quiet textbook reading surfaces with generous top air, a wide module-path navigator, black-outlined cards, restrained blue active states, and prose in a centered column. Pages with a topics panel begin their prose with a spaced introduction; the redundant opening title and its divider are visually hidden. In Paper, the topics panel has a lighter cream background around warm ivory page cards; the current page retains its blue border and Here badge.
- Interactives page: dense catalog layout, compact filters, grouped rows, small tags, and minimal explanatory copy.
- Resources page: quiet intro copy, a module card grid, and grouped external links — no dropdown menu, just one page.
- Mobile: stacked module cards, compact header controls, no horizontal page overflow, and readable card/prose rhythm.

## Surface Ladder

Every panel picks one of four surfaces, defined as tokens in `src/styles/global.css`. Depth, not hue, is what tells containers apart, and the ordering holds in all three themes.

| Token | Role |
| --- | --- |
| `--bg-primary` | the page itself |
| `--sim-bg` | a panel holding an interactive or reference block; recessed one step from the page |
| `--surface-plot` | the drawing surface a reader looks at: plot canvases, SVG plot rects, boxed diagrams; the lightest, cleanest area |
| `--surface-elevated` | chrome floating above a surface: block headers, secondary buttons, catalog list containers, and reading panels sitting directly on the page |

In Paper this reads as a warm recessed panel carrying light data surfaces: the vectors demos sit at `--sim-bg`, the plots inside them at `--surface-plot`, and the hedgehog opener and topics panel at `--surface-elevated`. Two rules follow:

- A panel is never painted `--bg-primary`. A container that matches the page reads as a missing surface, not a quiet one.
- A plot is never painted `--sim-bg`. Data marks belong on the light surface, not on the panel's own warm one.

An unboxed diagram that sits directly in the reading flow stays transparent; see [adding-simulations.md](adding-simulations.md).

Corners come from two tokens in the same file: `--radius-panel` (1rem) for a boxed panel such as `SimulationBlock`, and `--radius-control` (0.5rem) for buttons, answer options, and focus rings inside it. Pills and letter circles stay `rounded-full`. Write them as `rounded-[var(--radius-panel)]` rather than picking a Tailwind size. A control that sits inside another control's padding, such as a segmented filter button, uses `rounded-[calc(var(--radius-control)-0.25rem)]` so the corners stay concentric. The homepage's three module cards are the one deliberate exception: they keep their larger `2rem` hero corners.

## Lesson Tail

A lesson ends with its interactive, Problem Solving, the checkpoint, and the previous/next links. Only the interactive is a boxed panel. Problem Solving is a heading over hairline-divided disclosure rows (`WorkedExampleCard`), the checkpoint is a section opened by a top hairline, and the pager is text links under a rule. Separate these with headings and `--grid-line` hairlines, not new panels.

## Typography

The site uses one typeface, Atkinson Hyperlegible Next, self-hosted through `@fontsource-variable/atkinson-hyperlegible-next` and set as Tailwind's `--font-sans` in `src/styles/global.css`. It was chosen because similar characters such as I, l, 1 and 0, O stay distinct for students. Text takes one of five roles. Prose headings get them automatically; outside prose, use the role classes in `global.css`.

| Role | Class | Spec | Color |
| --- | --- | --- | --- |
| Heading | `.type-h1` / `.type-h2` / `.type-h3` | `clamp(2rem, 3vw, 2.5rem)` / `1.5rem` / `1.25rem`; 700, 700, 600 | `--text-primary` |
| Label | `.type-label` | `0.75rem`, 700, `0.1em`, uppercase | `--text-muted`; add `text-[var(--accent-blue)]` when the label names a section or panel |
| Title | `.type-title` | `1.125rem`, 600 | `--text-primary` |
| Body | none (inherited) | `1rem`, 400; strong is 600 | `--text-primary` |
| Supporting | `.type-supporting` | `0.875rem`, 400 | `--text-muted` |

- Uppercase belongs to the Label role only. Prose `h4` is a label, used for worked-example steps.
- Blue text marks links, section labels, and the pager's next lesson. The exception is a color that carries meaning, like elastic blue and inelastic red.
- Use weights 400, 600, and 700 only, and no negative letter-spacing.
- A component section such as Problem Solving or a checkpoint is named by a label. Its example titles and questions use the title role and are the largest text inside it.
- The homepage hero is exempt.

## Guardrails

- Do not replace the homepage with a marketing landing page or add explanatory hero copy unless the product direction changes.
- Do not restyle lesson pages into card-heavy dashboards; preserve the quiet textbook cadence.
- Prefer existing theme tokens from `src/styles/global.css`, and pick the surface from the ladder above rather than inventing a shade.
- The Tailwind `theme-*` color aliases in `tailwind.config.mjs` emit no CSS: this is Tailwind v4 with no `@config`, so the config file is never read. `border-theme-grid` falls back to `currentColor`, which is what produces the black-outlined cards. Do not "fix" those to `--grid-line`; write new code as `bg-[var(--token)]`.
- Tailwind cannot parse `bg-[<gradient>,var(--token)]`: it infers `background-image`, where a trailing color is invalid, and drops the declaration silently. Write the halves separately, as `bg-[color:var(--token)] bg-[image:<gradient>]`.
- Keep reusable visual changes in shared layout/component files instead of copying one-off styles through MDX pages.
- For visual changes, smoke-test `/`, `/interactives`, `/resources`, `/math/vectors`, and `/oscillations` at desktop and mobile widths.
