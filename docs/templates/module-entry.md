# Registering A New Lesson Page

After creating the page file from `docs/templates/lesson-page.mdx.template`, wire it
into the site's metadata. This is what makes it show up in navigation, the sitemap,
and the search palette, and what `npm run audit:repo` checks against the page file.

## 1. Add a `ModulePage` entry

In `src/data/modules/<domain>.ts`, add an entry to that module's `pages` array
(see `src/data/modules/types.ts` for the full type):

```ts
{
  id: '<domain>-<page-slug>',
  href: '/<domain>/<page-slug>',
  title: 'Page Title',
  description: 'One sentence describing what the page teaches.',
  seo: {
    title: 'Page Title',
    description: 'One sentence describing what the page teaches.',
    canonicalPath: '/<domain>/<page-slug>',
    image: '/social/physics-nook-card.svg',
    // noindex: true, // only for hidden experiments — see docs/adding-content.md
  },
},
```

`canonicalPath` must match the page's route exactly (no trailing slash except `/`).

If the domain is new, or the page belongs in a different nav grouping than its
own module (see the `mechanicsPath` / `wavesAndOscillationsPath` composite groups
in `src/data/modules/index.ts` for examples), also add it to the relevant
`ModulePathGroup` there. Prefer reusing an existing group before creating one.

## 2. Add an `InteractiveEntry` per mounted interactive

In `src/data/interactives.ts`, one entry per `InteractiveAnchor` on the page:

```ts
{
  id: 'your-interactive-id', // matches the InteractiveAnchor id on the page
  title: 'Interactive Title',
  description: 'What the reader can do with it.',
  href: '/<domain>/<page-slug>#your-interactive-id',
  module: 'Domain Label', // matches interactiveModuleOrder in the same file
  kind: 'inline', // or 'standalone' — see docs/adding-simulations.md
  tags: ['tag-one', 'tag-two'],
},
```

## 3. Verify

```sh
npm run audit:repo   # route <-> metadata consistency
npm run build        # for content-only changes
npm run check         # Astro type checking
```

For a page with simulation or scoring logic, also run the relevant
`npm run test:<domain>` script.
