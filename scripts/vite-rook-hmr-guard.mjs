import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOK_BUILD_GUARD_FILE = path.join(
  os.tmpdir(),
  "laplace-dev-rook-build.json",
);
const POST_RUN_GRACE_MS = 2500;
const STALE_ACTIVE_RUN_MS = 10 * 60 * 1000;

function canonicalPath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function isRookBuildGuardingWorkspace(cwd) {
  try {
    const raw = fs.readFileSync(ROOK_BUILD_GUARD_FILE, "utf8");
    const state = JSON.parse(raw);
    if (typeof state?.workspacePath !== "string") return false;
    if (canonicalPath(state.workspacePath) !== canonicalPath(cwd)) {
      return false;
    }
    const now = Date.now();
    if (state.active === true) {
      return (
        typeof state.updatedAtMs === "number" &&
        now - state.updatedAtMs < STALE_ACTIVE_RUN_MS
      );
    }
    return (
      typeof state.endedAtMs === "number" &&
      now - state.endedAtMs < POST_RUN_GRACE_MS
    );
  } catch {
    return false;
  }
}

export function isHmrDisabled() {
  return process.env.LAPLACE_NO_HMR === "1";
}

export function laplaceRookBuildHmrGuard() {
  const cwd = process.cwd();
  return {
    name: "laplace-rook-build-hmr-guard",
    handleHotUpdate() {
      if (isRookBuildGuardingWorkspace(cwd)) {
        return [];
      }
      return undefined;
    },
    configureServer(server) {
      const originalSend = server.ws.send.bind(server.ws);
      server.ws.send = (...args) => {
        const first = args[0];
        if (
          isRookBuildGuardingWorkspace(cwd) &&
          typeof first === "object" &&
          first !== null &&
          (first.type === "full-reload" ||
            first.type === "update" ||
            first.type === "error")
        ) {
          return;
        }
        return originalSend(...args);
      };
    },
  };
}
