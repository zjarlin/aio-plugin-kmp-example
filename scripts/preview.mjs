import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, relative, extname } from 'node:path';
import { parse, serialize, defaultTreeAdapter as tree } from 'parse5';

const port = Number(process.env.AIO_PREVIEW_PORT || 4189);
const origin = `http://127.0.0.1:${port}`;
const backend = new URL(process.env.AIO_PREVIEW_BACKEND || 'http://127.0.0.1:8088');
if (backend.protocol !== 'http:' || backend.hostname !== '127.0.0.1') throw new Error('Development backend must be loopback HTTP');
const assets = await realpath('dist/frontend');
const sdk = resolve(process.env.AIO_PLATFORM || '../aio-platform', 'sdk/web');
const ticket = randomBytes(32).toString('hex');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const policy = `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${origin}/; connect-src ${origin}/assets/; style-src 'unsafe-inline'; img-src data: blob:; font-src data: ${origin}/assets/; base-uri ${origin}/assets/`;

const server = createServer(async (request, response) => {
  const send = (status, body, type = 'text/plain', extra = {}) => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    response.end(body);
  };
  try {
    const path = new URL(request.url, origin).pathname;
    if (path === '/favicon.ico') return send(204, '');
    if (path === '/') return send(200, `<!doctype html><html><head><title>KMP Fullstack Preview</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;display:block;overflow:hidden}</style></head><body><iframe title="KMP Fullstack" sandbox="allow-scripts" src="/assets/index.html"></iframe><script type="module">
import { mountBridge } from '/host.mjs';
mountBridge(document.querySelector('iframe'), async request => {
  const response = await fetch('/invoke', {method:'POST',headers:{'content-type':'application/json','x-preview-ticket':'${ticket}'},body:JSON.stringify({...request,body:Array.from(request.body)})});
  if(!response.ok) throw new Error('Preview request rejected');
  const result = await response.json();
  return {...result,body:new Uint8Array(result.body)};
});
</script></body></html>`, 'text/html');
    if (path === '/host.mjs' || path === '/guest.js') return send(200, await readFile(resolve(sdk, path === '/host.mjs' ? 'host.mjs' : 'guest.js')), 'application/javascript', { 'Access-Control-Allow-Origin': '*' });
    if (path === '/invoke' && request.method === 'POST') {
      if (request.headers.origin !== origin || request.headers['x-preview-ticket'] !== ticket) return send(403, 'Rejected');
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) return send(413, 'Too large'); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (!/^\/(tasks(?:\/[0-9]+)?|counter)$/.test(input.path) || !['GET', 'POST', 'PATCH', 'DELETE'].includes(input.method)) return send(400, 'Invalid request');
      const result = await fetch(new URL(input.path, backend), {
        method: input.method,
        headers: { 'content-type': 'application/json', 'x-aio-tenant-id': 'preview', 'x-aio-user-id': 'developer' },
        body: input.method === 'GET' ? undefined : Buffer.from(input.body),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      return send(200, JSON.stringify({ status: result.status, headers: [], body: Array.from(new Uint8Array(await result.arrayBuffer())) }), 'application/json');
    }
    if (path.startsWith('/assets/')) {
      const file = await realpath(resolve(assets, decodeURIComponent(path.slice('/assets/'.length))));
      if (relative(assets, file).startsWith('..') || !(await stat(file)).isFile()) return send(404, 'Not found');
      let bytes = await readFile(file);
      if (extname(file) === '.html') {
        const document = parse(bytes.toString());
        const head = document.childNodes.find(node => node.tagName === 'html').childNodes.find(node => node.tagName === 'head');
        const script = tree.createElement('script', 'http://www.w3.org/1999/xhtml', [{ name: 'src', value: '/guest.js' }]);
        tree.insertBefore(head, script, head.childNodes[0]);
        bytes = Buffer.from(serialize(document));
      }
      return send(200, bytes, types[extname(file)] || 'application/octet-stream', { 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': policy });
    }
    send(404, 'Not found');
  } catch (error) { send(500, error.message); }
});
server.listen(port, '127.0.0.1', () => console.log(origin));
