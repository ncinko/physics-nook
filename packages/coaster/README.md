# coaster slop (machine-copied — do not edit)

Everything in this directory is copied verbatim from the coaster slop repo
(`C:\Users\Nick\Desktop\coaster`) by `npm run coaster:sync`. Edits made here
are silently overwritten by the next sync — make changes in the source repo.

- `game/` is imported by `apps/server/src/coaster.ts` (Node). It must stay pure
  JS: no React, no JSX, no DOM, no JSON imports.
- `components/` + `styles.css` are imported by `apps/client/coaster/` (Vite).
- Game assets sync to `apps/client/public/assets/` (the game hardcodes
  `/assets/...` paths).

Online-play caveat: the server hides other players' hands, the deck, and the
discard pile by replacing card ids with `null` placeholders (array lengths are
preserved). If a UI change starts rendering the *contents* of another player's
hand or the deck, it will crash online. Re-test multiplayer after every sync.
