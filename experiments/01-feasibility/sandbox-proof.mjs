// Tests the real Rook sandbox adapter against owned disposable fixtures only.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const rook = resolve(process.argv[2] ?? '../rook');
const { detectSandboxRuntime, createSandboxCommand } = await import(pathToFileURL(join(rook, 'dist/policy/sandbox.js')));
const root = await mkdtemp(join(tmpdir(), 'laplace-sandbox-01-'));
const cwd = join(root, 'workspace');
const report = { platform: process.platform, checks: [] };
const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
async function shell(command, workspace = cwd) {
  const spec = await createSandboxCommand(command, workspace, report.runtime);
  try {
    return await new Promise((resolve, reject) => {
      let output = '';
      const child = spawn(spec.executable, spec.args, { cwd: workspace, env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Sandbox command timeout')); }, 5000);
      child.stdout.on('data', data => output = (output + data).slice(-4000));
      child.stderr.on('data', data => output = (output + data).slice(-4000));
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
  } finally { await spec.cleanup?.(); }
}
try {
  report.runtime = await detectSandboxRuntime();
  assert(report.runtime, 'No supported sandbox runtime; execution must remain disabled');
  await mkdir(cwd);
  await writeFile(join(root, 'outside.txt'), 'outside fixture\n');
  git('init', '-b', 'main');
  await writeFile(join(cwd, 'fixture.txt'), 'fixture\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', 'commit', '-m', 'Fixture');
  assert.equal((await shell('printf workspace > allowed.txt')).code, 0);
  assert.equal(await readFile(join(cwd, 'allowed.txt'), 'utf8'), 'workspace');
  report.checks.push('workspace write succeeds');
  assert.notEqual((await shell('cat ../outside.txt')).code, 0);
  assert.notEqual((await shell('printf blocked > ../outside.txt')).code, 0);
  assert.equal(await readFile(join(root, 'outside.txt'), 'utf8'), 'outside fixture\n');
  report.checks.push('outside read and write denied');
  assert.notEqual((await shell('printf blocked > .git/config')).code, 0);
  report.checks.push('Git metadata write denied');
  const ordinary = await shell('git --no-optional-locks status --porcelain');
  report.ordinaryGitStatus = { code: ordinary.code, output: ordinary.output.replaceAll(root, '<fixture>') };
  report.checks.push('ordinary repository Git status outcome recorded');
  const worktree = join(root, 'linked');
  git('worktree', 'add', '-b', 'linked', worktree);
  const linked = await shell('git --no-optional-locks status --porcelain', worktree);
  report.linkedWorktreeGitStatus = { code: linked.code, output: linked.output.replaceAll(root, '<fixture>') };
  // Either outcome is evidence, not a blanket sandbox compatibility claim.
  report.checks.push('linked-worktree Git status outcome recorded');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
