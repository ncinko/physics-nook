// One-command ship for Mega Park: sync from the local repo, build, commit the
// synced files, push (Cloudflare Pages deploys the client from git), then
// deploy the WebSocket server to the VM.
//
// Order matters: the server deploy runs before the push finishes rolling out,
// and the protocol is additive, so a mid-game restart just reconnects clients.

import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYNCED_PATHS = ["packages/coaster", "apps/client/public/assets"];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: options.capture ? ["inherit", "pipe", "inherit"] : "inherit",
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (result.status !== 0 && !options.allowFail) {
    console.error(`coaster-ship: \`${command} ${args.join(" ")}\` failed.`);
    process.exit(result.status ?? 1);
  }
  return result;
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const confirm = async (question) => {
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
};

console.log("== 1/4 Sync from the Mega Park repo ==");
run("node", ["scripts/sync-coaster.mjs"]);

console.log("\n== 2/4 Build the game client (sanity check) ==");
run("npm", ["run", "game:build"]);

console.log("\n== 3/4 Commit & push synced files ==");
const status = run("git", ["status", "--porcelain", "--", ...SYNCED_PATHS], { capture: true });
const changes = status.stdout.trim();
if (!changes) {
  console.log("No changes in synced files — nothing to commit.");
} else {
  console.log(changes);
  if (await confirm("Commit and push these synced changes?")) {
    run("git", ["add", "--", ...SYNCED_PATHS]);
    run("git", ["commit", "-m", "Sync Mega Park from local coaster repo"]);
    run("git", ["push"]);
    console.log("Pushed — Cloudflare Pages (physics-nook-game) will rebuild game.physicsnook.com.");
  } else {
    console.log("Skipped commit/push. The live client will not update until you push.");
  }
}

console.log("\n== 4/4 Deploy the WebSocket server ==");
if (await confirm("Deploy the game server to the VM (git pull + restart)?")) {
  run("node", ["scripts/deploy-game-server.mjs"]);
} else {
  console.log("Skipped. Run `npm run game:server:deploy` when ready — rule changes need it.");
}

rl.close();
console.log("\ncoaster-ship: done. Smoke test: https://game.physicsnook.com/coaster/");
