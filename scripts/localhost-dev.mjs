// Dev launcher that binds Pantheon to the port assigned in the central
// LocalHost registry (D:/_Claude/LocalHost/registry.json). Falls back to 3004
// if the registry is absent, so `npm run dev` still works standalone.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const KEY = "pantheon";
const FALLBACK = 3004;
const here = dirname(fileURLToPath(import.meta.url));

function port() {
  try {
    const reg = JSON.parse(readFileSync(resolve(here, "../../../LocalHost/registry.json"), "utf8"));
    const p = reg.projects.find((x) => x.key === KEY)?.port;
    return typeof p === "number" ? p : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

const child = spawn("next", ["dev", "-p", String(port())], {
  cwd: resolve(here, ".."),
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
