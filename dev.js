// Local dev server: serves public/ and runs api/*.js the same way Vercel does.
// Usage: npm run dev  (reads Upstash + ADMIN_PASSWORD from .env.local)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const api = url.pathname.match(/^\/api\/([a-z]+)$/);
    if (api) {
      const mod = await import(`./api/${api[1]}.js`);
      const fn = mod[req.method];
      if (!fn) return res.writeHead(405).end();
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const response = await fn(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let path = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    if (path === '/') path = '/index.html';
    else if (!extname(path)) path += '.html';
    const body = await readFile(join('public', path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(e);
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'Not found' : 'Error');
  }
}).listen(PORT, () => console.log(`Buzzer running on http://localhost:${PORT}  (admin: /admin)`));
