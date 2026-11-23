// Supplementary Chromium checks. NOT native WKWebView/WebView2/WebKitGTK proof.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './desktop-probe/node_modules/playwright-core/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'desktop-probe/dist');
const config = JSON.parse(await readFile(join(here, 'desktop-probe/src-tauri/tauri.conf.json'), 'utf8'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' };
const server = createServer(async (req, res) => {
  const path = resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!path.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Content-Security-Policy': config.app.security.csp });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.LAPLACE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__laplaceProbeResult !== undefined, { timeout: 30000 });
  const result = await page.evaluate(() => window.__laplaceProbeResult);
  assert.equal(result.passed, true, JSON.stringify(result));
  await page.getByRole('button', { name: 'Switch theme' }).click();
  assert.equal(await page.locator('html').getAttribute('class'), 'light');
  await page.setViewportSize({ width: 1024, height: 768 });
  assert(await page.locator('#editor').evaluate(el => el.clientWidth > 300));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), viewport: '1440x900@1; resized to 1024x768',
    nativeQualification: false, result, extraChecks: ['light theme toggle', 'editor remains visible after resize', 'no uncaught page errors'] }, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
