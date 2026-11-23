// A REAL TypeScript language-server stdio exercise, independent of Monaco.
// Passing this does not qualify a Monaco/LSP bridge or native editor input.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dependencies = join(here, 'desktop-probe/node_modules');
const root = await mkdtemp(join(tmpdir(), 'laplace-lsp-01-'));
const report = { checks: [], timingsMs: {}, bridgeTested: false };
let child;
let closed;
let nextId = 0;
const pending = new Map();
let buffer = Buffer.alloc(0);
let diagnostics;
const diagnosticsReady = new Promise(resolve => diagnostics = resolve);
let stderr = '';
function send(message) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}
try {
  const serverRoot = join(dependencies, 'typescript-language-server');
  const serverPackage = JSON.parse(await readFile(join(serverRoot, 'package.json'), 'utf8'));
  report.languageServer = serverPackage.version;
  report.typescript = JSON.parse(await readFile(join(dependencies, 'typescript/package.json'), 'utf8')).version;
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'commonjs', target: 'es2022' }, include: ['*.ts'] }));
  await writeFile(join(root, 'value.ts'), 'export const answer = 42;\n');
  const source = 'import { answer } from "./value";\nconst item = { alpha: 1 };\nitem.alpha;\nconst broken: string = answer;\n';
  await writeFile(join(root, 'main.ts'), source);
  child = spawn(process.execPath, [join(serverRoot, serverPackage.bin['typescript-language-server']),
    '--stdio'], { cwd: root, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  closed = new Promise(resolve => child.once('close', resolve));
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  child.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); });
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const size = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
      if (buffer.length < end + 4 + size) return;
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + size));
      buffer = buffer.subarray(end + 4 + size);
      if (message.method && message.id !== undefined) {
        send({ id: message.id, result: message.method === 'workspace/configuration' ? message.params.items.map(() => ({})) : null });
      } else if (message.id !== undefined) {
        const item = pending.get(message.id);
        if (item) { clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); }
      } else if (message.method === 'textDocument/publishDiagnostics' && message.params.uri.endsWith('/main.ts') && message.params.diagnostics.some(d => d.code === 2322)) {
        diagnostics(message.params.diagnostics);
      }
    }
  });
  const start = performance.now();
  const initialized = await request('initialize', { processId: process.pid, rootUri: pathToFileURL(root).href,
    initializationOptions: { tsserver: { path: join(dependencies, 'typescript/lib/tsserver.js') } },
    capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true },
      completion: { completionItem: { snippetSupport: true } } } } });
  assert(initialized.capabilities.definitionProvider);
  send({ method: 'initialized', params: {} });
  const uri = pathToFileURL(join(root, 'main.ts')).href;
  send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text: source } } });
  let diagTimer;
  const errors = await Promise.race([diagnosticsReady, new Promise((_, reject) => {
    diagTimer = setTimeout(() => reject(new Error('Diagnostics timeout')), 20000);
  })]).finally(() => clearTimeout(diagTimer));
  report.timingsMs.initializeThroughDiagnostics = Math.round(performance.now() - start);
  assert(errors.some(error => error.code === 2322));
  report.checks.push('real semantic diagnostic TS2322');
  const completions = await request('textDocument/completion', { textDocument: { uri }, position: { line: 2, character: 5 } });
  assert((Array.isArray(completions) ? completions : completions.items).some(item => item.label === 'alpha'));
  report.checks.push('member completion alpha');
  const definitions = await request('textDocument/definition', { textDocument: { uri }, position: { line: 0, character: 10 } });
  const locations = Array.isArray(definitions) ? definitions : [definitions];
  assert(locations.some(item => (item.uri ?? item.targetUri).endsWith('/value.ts')));
  report.checks.push('cross-file definition navigation to value.ts');
  await request('shutdown', null);
  send({ method: 'exit' });
  let exitTimer;
  await Promise.race([closed, new Promise((_, reject) => { exitTimer = setTimeout(() => reject(new Error('Server failed to exit')), 3000); })]).finally(() => clearTimeout(exitTimer));
  assert.equal(child.exitCode, 0);
  report.checks.push('shutdown/exit reaps language-server process');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  report.stderr = stderr;
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await closed;
  for (const item of pending.values()) clearTimeout(item.timer);
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
