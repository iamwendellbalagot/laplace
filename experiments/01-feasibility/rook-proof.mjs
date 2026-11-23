// Runs the REAL installed Rook/Pi runtime without provider inference or mock gateway.
// No changes to Rook's repository, credentials, settings or existing sessions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const rook = resolve(process.argv[2] ?? '../rook');
const root = await mkdtemp(join(tmpdir(), 'laplace-rook-01-'));
const report = { node: process.version, inference: false, checks: [], timingsMs: {} };
let gateway;
try {
  const cwd = join(root, 'workspace');
  const sessionDir = join(root, 'sessions');
  await mkdir(cwd);
  await writeFile(join(cwd, 'fixture.txt'), 'read-only fixture\n');
  // Pi reads this at module initialization; set BEFORE importing Rook.
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  process.env.ROOK_PLYTH_MODE = 'off';
  process.env.ROOK_PLYTH_INTEGRATED = 'off';
  process.env.ROOK_PLYTH_TRACE = '0';
  const metadata = JSON.parse(await readFile(join(rook, 'package.json'), 'utf8'));
  report.packageVersion = metadata.version;
  report.cliVersion = execFileSync(process.execPath, [join(rook, 'bin/rook.mjs'), '--version'], { encoding: 'utf8' }).trim();
  report.rookCommit = execFileSync('git', ['-C', rook, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  report.gatewayBuildSha256 = createHash('sha256').update(await readFile(join(rook, 'dist/pi/pi-agent-gateway.js'))).digest('hex');
  const { createPiAgentGateway } = await import(pathToFileURL(join(rook, 'dist/pi/pi-agent-gateway.js')));
  const { ToolPolicy } = await import(pathToFileURL(join(rook, 'dist/policy/tool-policy.js')));
  const { detectSandboxRuntime } = await import(pathToFileURL(join(rook, 'dist/policy/sandbox.js')));
  const sdkRoot = join(rook, 'node_modules/@earendil-works/pi-coding-agent');
  const sdkMetadata = JSON.parse(await readFile(join(sdkRoot, 'package.json'), 'utf8'));
  report.piVersion = sdkMetadata.version;
  const { SessionManager } = await import(pathToFileURL(join(sdkRoot, sdkMetadata.exports['.'].import)));

  const start = performance.now();
  gateway = await createPiAgentGateway(cwd, { sessionDir, isolatedEvaluation: true });
  report.timingsMs.initialize = Math.round(performance.now() - start);
  report.checks.push('real gateway initialized, isolated agent/session directories');
  const events = [];
  const unsubscribe = gateway.subscribe(event => events.push(event.type));
  assert(events.includes('todo_updated') && events.includes('context_usage'));
  report.checks.push('typed subscription initial state delivered');
  const planTools = gateway.getActiveTools();
  assert(!planTools.some(name => ['write', 'edit', 'bash'].includes(name)));
  gateway.setMode('build');
  assert(['write', 'edit', 'bash'].every(name => gateway.getActiveTools().includes(name)));
  gateway.setMode('plan');
  assert.deepEqual(gateway.getActiveTools(), planTools);
  report.checks.push('Plan/Build/Plan tool-set transition');

  const policy = new ToolPolicy(cwd);
  assert.equal((await policy.check('read', { path: 'fixture.txt' }, 'read')).allowed, true);
  for (const tool of ['write', 'edit', 'bash']) {
    const input = tool === 'bash' ? { command: 'true' } : { path: 'fixture.txt', content: 'blocked' };
    assert.equal((await policy.check(tool, input, tool)).allowed, false);
  }
  assert.equal((await policy.check('mcp__fixture__mutate', {}, 'mcp-denied')).allowed, false);
  policy.setMcpUserAuthorization('Use mcp__fixture__mutate');
  // Important limitation: generic MCP approval is not a read-only guarantee in Plan.
  assert.equal((await policy.check('mcp__fixture__mutate', {}, 'mcp-authorized')).allowed, true);
  report.checks.push('Plan policy denies writes/edit/shell; explicit MCP authorization can still allow a mutating-named tool (no tool executed)');

  const first = gateway.currentSession().id;
  await gateway.newSession();
  assert.notEqual(gateway.currentSession().id, first);
  assert.deepEqual(gateway.sessionHistory(), []);
  report.checks.push('new session changes identity and clears history');
  // Seed a REAL persisted session, not fabricated model output.
  const seeded = SessionManager.create(cwd, sessionDir);
  seeded.appendMessage({ role: 'user', content: 'Laplace offline lifecycle fixture', timestamp: Date.now() });
  seeded.appendCustomEntry('laplace_feasibility', { inference: false });
  const path = seeded.getSessionFile();
  // Some SDK versions defer persistence until an assistant turn. Explicit persist
  // is not a public guarantee; fail rather than silently fabricate a saved file.
  await readFile(path);
  await gateway.resumeSession(path);
  assert.equal(gateway.currentSession().id, seeded.getSessionId());
  assert(gateway.sessionHistory().some(message => message.text.includes('offline lifecycle fixture')));
  assert((await gateway.listSessions()).some(session => session.id === seeded.getSessionId()));
  await gateway.cancel(); // Idle cancellation only; not an active-run cancellation proof.
  assert.equal(gateway.isRunning(), false);
  report.checks.push('persisted session resume/list/history; idle cancel');
  unsubscribe();
  await gateway.dispose();
  gateway = undefined;
  // Fixed allowlist cannot be widened by switching to Build. No MCP extensions.
  gateway = await createPiAgentGateway(cwd, {
    sessionDir: join(root, 'readonly-sessions'), isolatedEvaluation: true,
    readOnlyTools: ['read', 'rook_search'],
  });
  gateway.setMode('build');
  assert.deepEqual(gateway.getActiveTools(), ['read', 'rook_search']);
  report.checks.push('immutable read-only allowlist remains narrow in Build');
  report.sandboxRuntime = await detectSandboxRuntime() ?? 'unavailable';
  report.checks.push('sandbox detection only; not an enforcement proof');
  assert.equal(await readFile(join(cwd, 'fixture.txt'), 'utf8'), 'read-only fixture\n');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await gateway?.dispose();
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
