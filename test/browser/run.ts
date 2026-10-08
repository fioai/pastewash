/**
 * Washes every fixture, and a few hundred random documents, with the browser entry point (the
 * real DOMParser) in headless Chromium, and checks the results are the same as Node's (parse5).
 *
 * Run with `npm run test:browser`. Uses $CHROME, or chromium / google-chrome on the PATH.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { wash } from '../../src/node.ts';
import { fixtures, randomHtml, rng } from '../support.ts';

const root = join(import.meta.dirname, '..', '..');

function findChrome(): string {
  const candidates = [process.env.CHROME, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']
    .filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (spawnSync(c, ['--version']).status === 0) return c;
  }
  throw new Error('no Chromium found; set $CHROME');
}

const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = readFileSync(join(root, path));
    const type = { '.html': 'text/html', '.js': 'text/javascript' }[extname(path)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

const profile = mkdtempSync(join(tmpdir(), 'pastewash-chrome-'));
// Chromium gets a process group of its own, so that all its processes can be stopped together: its
// helpers go on writing to the profile after the main process has gone.
const chrome = spawn(
  findChrome(),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', 'about:blank'],
  { detached: true },
);
const exited = new Promise((resolve) => chrome.once('exit', resolve));
function stopChrome(): void {
  try {
    if (process.platform === 'win32') chrome.kill();
    else process.kill(-chrome.pid!, 'SIGKILL');
  } catch {
    // Already gone.
  }
}
async function shutDown(): Promise<void> {
  server.close();
  stopChrome();
  await exited;
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  } catch (e) {
    console.warn(`couldn't remove ${profile}: ${(e as Error).message}`);
  }
}
// In its own group, Chromium doesn't get the terminal's Ctrl-C.
process.once('SIGINT', () => void shutDown().then(() => process.exit(130)));

let failures = 0;
try {
  const devtools = await new Promise<string>((resolve, reject) => {
    let err = '';
    chrome.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(err);
      if (m) resolve(m[1]!);
    });
    chrome.on('exit', () => reject(new Error(`Chromium exited:\n${err}`)));
  });

  const http = devtools.replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
  const target = (await (await fetch(`${http}/json/new?about:blank`, { method: 'PUT' })).json()) as {
    webSocketDebuggerUrl: string;
  };
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  let next = 0;
  const pending = new Map<number, (result: unknown) => void>();
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown };
    if (msg.id !== undefined) pending.get(msg.id)?.(msg.error ? { error: msg.error } : msg.result);
  });
  function send(method: string, params: object = {}): Promise<unknown> {
    const id = ++next;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  }
  async function evaluate(expression: string): Promise<unknown> {
    const r = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as {
      result?: { value?: unknown };
      exceptionDetails?: unknown;
    };
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }

  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/test/browser/page.html` });
  for (let i = 0; (await evaluate('document.title')) !== 'ready'; i++) {
    if (i > 100) throw new Error('the test page never loaded dist/index.js (run npm run build)');
    await new Promise((r) => setTimeout(r, 50));
  }

  const cases = [
    ...fixtures().map((f) => ({ label: f.id, input: f.input, options: f.options })),
    ...Array.from({ length: 300 }, (_, i) => ({ label: `seed ${i + 1}`, input: randomHtml(rng(i + 1)), options: {} })),
  ];
  for (const c of cases) {
    const inBrowser = (await evaluate(
      `JSON.stringify(window.wash(${JSON.stringify(c.input)}, ${JSON.stringify(c.options)}))`,
    )) as string;
    const inNode = JSON.stringify(wash(c.input, c.options));
    if (inBrowser !== inNode) {
      failures++;
      console.error(`✖ ${c.label}\n  browser: ${inBrowser}\n  node:    ${inNode}`);
    }
  }
  console.log(`${cases.length - failures} of ${cases.length} the same in Chromium as in Node`);
} finally {
  await shutDown();
}
process.exit(failures ? 1 : 0);
