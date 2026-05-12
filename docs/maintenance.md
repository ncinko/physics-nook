# Maintenance

This project should stay clean enough that new physics work has an obvious place to land.

## Cleanup Policy

Do not commit generated output, local browser profiles, local Cloudflare state, root log files, or ad-hoc QA screenshots.

Ignored generated paths include:

```text
dist/
apps/client/dist/
.astro/
.wrangler/
.edge-profile/
qa-screenshots/
*.log
node_modules/
```

Screenshots are useful for local QA, but they should stay untracked unless the project adopts a named visual-baseline workflow.

## Dependency Updates

Use small regular updates for patch/minor versions:

```sh
npm outdated
npm install
npm run check
npm run build
npm run game:build
```

Treat major upgrades separately. For UI packages such as `lucide-react`, run the type check and both builds after the upgrade, then smoke-test pages that import the package.

Run `npm prune` or start from a fresh `npm ci` if `npm ls --depth=0` reports extraneous packages.

## Verification Commands

Use the full suite before landing broad maintenance work:

```sh
npm run test:all
npm run check
npm run build
npm run game:build
```

For targeted work, run the relevant domain test plus the build that owns the changed surface.

## Large Chunk Warning

Astro currently warns about large chunks because heavy libraries such as Three and KaTeX are used by interactive pages. Do not suppress the warning blindly. First confirm that heavy chunks are isolated to the pages that need them, then add manual chunks or adjust the warning threshold only with a short note explaining why.

## Long-Term Organization

When adding new behavior, keep the boundaries clear:

- physics/model logic in `src/lib` or `packages/shared`;
- rendering and controls in components or game client files;
- server authority and validation in `apps/server` or `functions`;
- behavior tests in `tests/<domain>`.
