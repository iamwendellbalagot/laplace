import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { Terminal } from '@xterm/xterm';
import { invoke, isTauri } from '@tauri-apps/api/core';
import '@xterm/xterm/css/xterm.css';
import './style.css';

const started = performance.now();
const workers = new Set();
const violations = [];
document.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective));
self.MonacoEnvironment = { getWorker(_moduleId, label) {
  const worker = label === 'typescript' || label === 'javascript' ? new TypeScriptWorker() : new EditorWorker();
  workers.add(worker);
  return worker;
} };
const source = 'export const answer = 42;\nconst result = answer;\nconst item = { alpha: 1 };\nitem.alpha;\nconst broken: string = 42;\n';
const model = monaco.editor.createModel(source, 'typescript', monaco.Uri.parse('file:///laplace-fixture.ts'));
const editor = monaco.editor.create(document.querySelector('#editor'), {
  model, theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 14,
});
const terminal = new Terminal({ cols: 70, rows: 8, scrollback: 500, fontSize: 13 });
terminal.open(document.querySelector('#terminal'));
terminal.writeln('Local xterm.js echo — NOT a native PTY.');
const terminalInput = terminal.onData(data => terminal.write(data));
document.querySelector('#theme').onclick = () => {
  const light = document.documentElement.classList.toggle('light');
  monaco.editor.setTheme(light ? 'vs' : 'vs-dark');
};
let running = false;
async function checks() {
  if (running) return;
  running = true;
  const result = { native: isTauri(), workerDiagnostics: false, completion: false, definition: false,
    cspViolations: violations, terminal: 'xterm local echo only', measurement: 'programmatic model edit to two animation frames; NOT physical typing latency' };
  try {
    if (result.native) {
      result.ipc = await invoke('ping', { schemaVersion: 1 });
      result.ipcError = false;
      try { await invoke('ping', { schemaVersion: 999 }); }
      catch (error) { result.ipcError = error === 'unsupported probe schema'; }
      if (!result.ipcError) throw new Error('IPC error path did not reject');
    }
    const worker = await (await monaco.typescript.getTypeScriptWorker())(model.uri);
    result.workerDiagnostics = (await worker.getSemanticDiagnostics(model.uri.toString())).some(d => d.code === 2322);
    const completion = await worker.getCompletionsAtPosition(model.uri.toString(), source.indexOf('item.alpha') + 5);
    result.completion = completion.entries.some(entry => entry.name === 'alpha');
    result.definition = (await worker.getDefinitionAtPosition(model.uri.toString(), source.indexOf('= answer') + 3)).length > 0;
    const latencies = [];
    for (let i = 0; i < 30; i++) {
      terminal.writeln(`Bounded local output ${i}: ${'background '.repeat(8)}`);
      const before = performance.now();
      const last = model.getLineCount();
      model.applyEdits([{ range: new monaco.Range(last, 1, last, 1), text: '// probe\n' }]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      latencies.push(performance.now() - before);
    }
    latencies.sort((a, b) => a - b);
    result.editTwoFrameP95Ms = Math.round(latencies[Math.ceil(latencies.length * .95) - 1]);
    result.elapsedMs = Math.round(performance.now() - started);
    result.passed = result.workerDiagnostics && result.completion && result.definition && violations.length === 0;
  } catch (error) {
    result.passed = false;
    result.error = String(error);
  }
  document.querySelector('#results').textContent = JSON.stringify(result, null, 2);
  window.__laplaceProbeResult = result;
  running = false;
  if (isTauri()) await invoke('report', { result });
}
document.querySelector('#checks').onclick = checks;
window.addEventListener('beforeunload', () => {
  terminalInput.dispose(); terminal.dispose(); editor.dispose(); model.dispose();
  for (const worker of workers) worker.terminate();
});
checks();
