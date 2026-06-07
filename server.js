import { createServer } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyze, getErrorStatus, MODEL, sendHealth, sendJson } from './lib/insurance-ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function safeJoin(base, target) {
  const resolved = path.resolve(base, target.replace(/^\/+/, ''));
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const filePath = safeJoin(publicDir, pathname);

  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const file = await readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
      sendHealth(res);
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/analyze') {
      await analyze(req, res);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: '지원하지 않는 메서드입니다.' });
  } catch (error) {
    sendJson(res, getErrorStatus(error), { error: error.message || '서버 오류가 발생했습니다.' });
  }
});

server.listen(PORT, () => {
  console.log(`Insurance Protector is running on http://localhost:${PORT} with ${MODEL}`);
});
