// Sync the Mega Park board game source from its home repo into this monorepo.
//
// Source of truth: C:\Users\Nick\Desktop\coaster (override with COASTER_SRC).
// Run `npm run coaster:sync` after any change there, review `git diff`, commit.
//
// Destinations are machine-owned mirrors — never edit them by hand:
//   packages/coaster/game        <- src/game        (pure logic; imported by the WS server)
//   packages/coaster/components  <- src/components  (React UI; imported by apps/client/coaster)
//   packages/coaster/styles.css  <- src/styles.css
//   apps/client/public/assets    <- public/assets   (served at /assets/... — the game
//                                                    hardcodes those absolute paths)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(process.env.COASTER_SRC ?? "C:/Users/Nick/Desktop/coaster");

const COPIES = [
  ["src/game", "packages/coaster/game"],
  ["src/components", "packages/coaster/components"],
  ["src/styles.css", "packages/coaster/styles.css"],
  ["public/assets", "apps/client/public/assets"],
];

// Only these destinations may ever be deleted/overwritten by this script.
const DEST_WHITELIST = new Set(COPIES.map(([, dest]) => dest));

const fail = (message) => {
  console.error(`sync-coaster: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(path.join(SRC, "src/game/reducer.js"))) {
  fail(`source repo not found or unexpected layout: ${SRC} (missing src/game/reducer.js). Set COASTER_SRC to override.`);
}

const countFiles = (target) => {
  if (!fs.existsSync(target)) return 0;
  if (fs.statSync(target).isFile()) return 1;
  return fs
    .readdirSync(target, { withFileTypes: true })
    .reduce((total, entry) => total + countFiles(path.join(target, entry.name)), 0);
};

let totalFiles = 0;
for (const [from, to] of COPIES) {
  if (!DEST_WHITELIST.has(to)) fail(`destination not whitelisted: ${to}`);
  const srcPath = path.join(SRC, from);
  const destPath = path.join(repoRoot, to);
  if (!fs.existsSync(srcPath)) fail(`missing source path: ${srcPath}`);

  fs.rmSync(destPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.cpSync(srcPath, destPath, { recursive: true });

  const copied = countFiles(destPath);
  totalFiles += copied;
  console.log(`  ${from}  ->  ${to}  (${copied} file${copied === 1 ? "" : "s"})`);
}

// The WS server imports packages/coaster/game/*.js directly under Node.
// If React (or any JSX) ever leaks into those files, the server would crash on
// boot — catch it here instead of on the VM.
for (const name of ["reducer.js", "logic.js", "cards.js", "hex.js"]) {
  const file = path.join(repoRoot, "packages/coaster/game", name);
  if (!fs.existsSync(file)) fail(`expected pure game file missing after sync: game/${name}`);
  const text = fs.readFileSync(file, "utf8");
  if (/from\s+["']react["']|import\s+React/.test(text)) {
    fail(`game/${name} imports React — the WS server cannot load it. Keep game/ free of UI code.`);
  }
}

fs.writeFileSync(
  path.join(repoRoot, "packages/coaster/README.md"),
  `# Mega Park (machine-copied — do not edit)

Everything in this directory is copied verbatim from the Mega Park repo
(\`C:\\Users\\Nick\\Desktop\\coaster\`) by \`npm run coaster:sync\`. Edits made here
are silently overwritten by the next sync — make changes in the source repo.

- \`game/\` is imported by \`apps/server/src/coaster.ts\` (Node). It must stay pure
  JS: no React, no JSX, no DOM, no JSON imports.
- \`components/\` + \`styles.css\` are imported by \`apps/client/coaster/\` (Vite).
- Game assets sync to \`apps/client/public/assets/\` (the game hardcodes
  \`/assets/...\` paths).

Online-play caveat: the server hides other players' hands, the deck, and the
discard pile by replacing card ids with \`null\` placeholders (array lengths are
preserved). If a UI change starts rendering the *contents* of another player's
hand or the deck, it will crash online. Re-test multiplayer after every sync.
`,
);

fs.writeFileSync(
  path.join(repoRoot, "packages/coaster/.synced.json"),
  JSON.stringify({ source: SRC, syncedAt: new Date().toISOString(), fileCount: totalFiles }, null, 2) + "\n",
);

console.log(`sync-coaster: ${totalFiles} files synced from ${SRC}`);
console.log("Review with `git diff`, then commit. Deploy: server first (npm run game:server:deploy), then push.");
