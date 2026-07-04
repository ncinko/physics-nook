// Deploy the WebSocket game server to the GCP VM (physics-nook-game-server).
//
// The server has zero npm runtime dependencies, so a deploy is just
// `git pull` + restart on the VM. Configure the restart command once in a
// `.env` file at the repo root (or as an environment variable):
//
//   GAME_SERVER_RESTART_CMD=sudo systemctl restart physics-nook-game
//   # or: GAME_SERVER_RESTART_CMD=pm2 restart game-server
//
// Optional overrides:
//   GAME_SERVER_VM=physics-nook-game-server
//   GAME_SERVER_ZONE=us-central1-a          (adds --zone to gcloud)
//   GAME_SERVER_REPO_DIR=~/physics-nook-astro

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const loadDotEnv = () => {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return {};
  const entries = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !line.trim().startsWith("#")) entries[match[1]] = match[2];
  }
  return entries;
};

const dotEnv = loadDotEnv();
const config = (key, fallback) => process.env[key] ?? dotEnv[key] ?? fallback;

const vm = config("GAME_SERVER_VM", "physics-nook-game-server");
const zone = config("GAME_SERVER_ZONE", null);
const repoDir = config("GAME_SERVER_REPO_DIR", "~/physics-nook-astro");
const restartCmd = config("GAME_SERVER_RESTART_CMD", null);

if (!restartCmd) {
  console.error(
    [
      "deploy-game-server: GAME_SERVER_RESTART_CMD is not set.",
      "",
      "Add it to a .env file at the repo root, matching how the server runs on the VM, e.g.:",
      "  GAME_SERVER_RESTART_CMD=sudo systemctl restart physics-nook-game",
      "  GAME_SERVER_RESTART_CMD=pm2 restart game-server",
      "",
      "To find out, SSH in (gcloud compute ssh " + vm + ") and check:",
      "  systemctl list-units | grep -i physics   # systemd?",
      "  pm2 ls                                   # pm2?",
      "  ps aux | grep server.ts                  # bare node?",
    ].join("\n"),
  );
  process.exit(1);
}

const remoteCommand = `cd ${repoDir} && git pull --ff-only && ${restartCmd}`;
const args = ["compute", "ssh", vm, "--command", remoteCommand];
if (zone) args.push("--zone", zone);

console.log(`deploy-game-server: gcloud ${args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
const result = spawnSync("gcloud", args, { stdio: "inherit", shell: process.platform === "win32" });
if (result.status !== 0) {
  console.error("deploy-game-server: gcloud command failed.");
  process.exit(result.status ?? 1);
}

const checkHealth = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = await response.text();
    console.log(`  ${url} -> ${response.status} ${body.slice(0, 200)}`);
    return response.ok;
  } catch (error) {
    console.error(`  ${url} -> ${error.message}`);
    return false;
  }
};

console.log("deploy-game-server: waiting 3s for the server to come back...");
await new Promise((resolve) => setTimeout(resolve, 3000));

const healthy =
  (await checkHealth("https://ws.physicsnook.com/health")) &&
  (await checkHealth("https://ws.physicsnook.com/coaster/health"));

if (!healthy) {
  console.error("deploy-game-server: health check failed — investigate on the VM.");
  process.exit(1);
}
console.log("deploy-game-server: healthy.");
