#!/usr/bin/env node
// Stages a self-contained Rook + Node payload into src-tauri/resources/rook-runtime for release bundling.
// Usage:
//   node scripts/stage-rook-runtime.mjs --rook-version 0.1.7 [--node-bin /path/to/node]
//   node scripts/stage-rook-runtime.mjs --local-rook ../rook   (pre-publish beta bundling only)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value.`);
  return value;
}

function fail(message) {
  console.error(`stage-rook-runtime: ${message}`);
  process.exit(1);
}

const rookVersion = option("--rook-version");
const localRook = option("--local-rook");
const nodeBin = resolve(option("--node-bin") ?? process.execPath);
const outDir = resolve(
  option("--out") ?? join(root, "src-tauri/resources/rook-runtime"),
);

if ((rookVersion ? 1 : 0) + (localRook ? 1 : 0) !== 1) {
  fail("Pass exactly one of --rook-version <exact> or --local-rook <path>.");
}
if (rookVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rookVersion)) {
  fail("--rook-version must be an exact version (no ranges or tags).");
}
if (!existsSync(nodeBin)) fail(`Node binary not found: ${nodeBin}`);

const nodeVersion = execFileSync(nodeBin, ["--version"], {
  encoding: "utf8",
}).trim();
const [major, minor] = nodeVersion.slice(1).split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  fail(`Rook requires Node >=22.19.0; staged Node is ${nodeVersion}.`);
}

const platformMap = { darwin: "macos", win32: "windows", linux: "linux" };
const archMap = { arm64: "aarch64", x64: "x86_64" };
const platform = platformMap[process.platform];
const arch = archMap[process.arch];
if (!platform || !arch)
  fail(`Unsupported build host ${process.platform}/${process.arch}.`);

const scratch = mkdtempSync(join(tmpdir(), "laplace-rook-stage-"));
const npmEnv = {
  ...process.env,
  PATH: `${dirname(nodeBin)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
};
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  const packCwd = localRook ? resolve(localRook) : scratch;
  const packTarget = localRook ? [] : [`rook-agent@${rookVersion}`];
  if (localRook && !existsSync(join(packCwd, "package.json"))) {
    fail(`No package.json in ${packCwd}.`);
  }
  const packed = execFileSync(
    npm,
    ["pack", ...packTarget, "--pack-destination", scratch, "--json"],
    { cwd: packCwd, encoding: "utf8", env: npmEnv },
  );
  const tarball = join(scratch, JSON.parse(packed)[0].filename);
  execFileSync("tar", ["-xzf", tarball, "-C", scratch]);
  const extracted = join(scratch, "package");

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rookDir = join(outDir, "rook");
  renameSync(extracted, rookDir);

  const pkg = JSON.parse(readFileSync(join(rookDir, "package.json"), "utf8"));
  if (rookVersion && pkg.version !== rookVersion) {
    fail(
      `Packed rook-agent ${pkg.version} does not match requested ${rookVersion}.`,
    );
  }

  execFileSync(
    npm,
    [
      "install",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ],
    { cwd: rookDir, stdio: "inherit", env: npmEnv },
  );

  for (const forbidden of ["models.json", ".rook", ".git", "auth.json"]) {
    rmSync(join(rookDir, forbidden), { recursive: true, force: true });
  }

  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const stagedNode = join(outDir, nodeName);
  copyFileSync(nodeBin, stagedNode);
  if (process.platform !== "win32") chmodSync(stagedNode, 0o755);

  // Native module must load under the exact staged Node runtime.
  execFileSync(stagedNode, ["-e", "require('better-sqlite3')"], {
    cwd: rookDir,
    stdio: "inherit",
  });
  execFileSync(stagedNode, [join(rookDir, "bin", "rook.mjs"), "--version"], {
    cwd: rookDir,
    stdio: "inherit",
  });

  const notices = join(outDir, "NOTICES");
  mkdirSync(notices, { recursive: true });
  for (const name of readdirSync(rookDir)) {
    if (/^(LICENSE|THIRD_PARTY_NOTICES)/i.test(name)) {
      copyFileSync(
        join(rookDir, name),
        join(notices, `rook-${basename(name)}`),
      );
    }
  }

  const manifest = {
    rookVersion: pkg.version,
    nodeVersion,
    platform,
    arch,
    nodeBin: nodeName,
    rookEntry: "rook/bin/rook.mjs",
    source: localRook ? "local-checkout" : "npm-registry",
    sha256: createHash("sha256").update(readFileSync(stagedNode)).digest("hex"),
  };
  writeFileSync(
    join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `Staged rook-agent ${pkg.version} + Node ${nodeVersion} (${platform}/${arch}) -> ${outDir}`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
