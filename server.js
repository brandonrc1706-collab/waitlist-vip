const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambia-esta-contrasena';
const root = __dirname;
const dbPath = path.join(root, 'data', 'waitlist.json');
const sessions = new Set();

function readDb() {
  try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
  catch { return []; }
}
function writeDb(entries) { fs.writeFileSync(dbPath, JSON.stringify(entries, null, 2)); }
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 100_000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON inválido')); } });
  });
}
function isAdmin(req) {
  const match = (req.headers.cookie || '').match(/waitlist_session=([^;]+)/);
  return Boolean(match && sessions.has(match[1]));
}
function stats(entries) {
  const waiting = entries.filter(e => e.status === 'waiting');
  const serving = entries.filter(e => e.status === 'serving');
  const completed = entries.filter(e => e.status === 'completed');
  const waits = completed.filter(e => e.completedAt).map(e => e.completedAt - e.createdAt);
  return { waiting: waiting.length, serving: serving.length, completed: completed.length, averageWaitMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length / 60000) : 0 };
}
function publicEntry(e) { return { id: e.id, name: e.name, partySize: e.partySize, status: e.status, createdAt: e.createdAt }; }
function serveFile(res, file) {
  const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
  fs.readFile(path.join(root, 'public', file), (err, data) => {
    if (err) return json(res, 404, { error: 'Página no encontrada' });
    res.writeHead(200, { 'Content-Type': type }); res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && ['/', '/index.html'].includes(url.pathname)) return serveFile(res, 'index.html');
    if (req.method === 'GET' && url.pathname === '/admin.html') return serveFile(res, 'admin.html');
    if (req.method === 'GET' && url.pathname === '/display.html') return serveFile(res, 'display.html');
    if (req.method === 'GET' && url.pathname === '/api/queue') {
      const entries = readDb(); return json(res, 200, { entries: entries.filter(e => e.status !== 'completed').map(publicEntry), stats: stats(entries) });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/queue') {
      if (!isAdmin(req)) return json(res, 401, { error: 'No autorizado' });
      const entries = readDb(); return json(res, 200, { entries, stats: stats(entries) });
    }
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await parseBody(req); const name = String(body.name || '').trim().slice(0, 60);
      const phone = String(body.phone || '').trim().slice(0, 30); const partySize = Math.min(20, Math.max(1, Number(body.partySize) || 1));
      if (!name) return json(res, 400, { error: 'Ingresa tu nombre.' });
      const entries = readDb(); const entry = { id: crypto.randomUUID(), name, phone, partySize, status: 'waiting', createdAt: Date.now() };
      entries.push(entry); writeDb(entries);
      const position = entries.filter(e => e.status === 'waiting').findIndex(e => e.id === entry.id) + 1;
      return json(res, 201, { entry: publicEntry(entry), position });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const body = await parseBody(req);
      const supplied = Buffer.from(String(body.password || ''));
      const expected = Buffer.from(ADMIN_PASSWORD);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return json(res, 401, { error: 'Contraseña incorrecta.' });
      const token = crypto.randomUUID(); sessions.add(token);
      res.writeHead(204, { 'Set-Cookie': `waitlist_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` }); return res.end();
    }
    const update = url.pathname.match(/^\/api\/admin\/entry\/([\w-]+)$/);
    if (req.method === 'PATCH' && update) {
      if (!isAdmin(req)) return json(res, 401, { error: 'No autorizado' });
      const body = await parseBody(req); const entries = readDb(); const entry = entries.find(e => e.id === update[1]);
      if (!entry || !['waiting', 'serving', 'completed'].includes(body.status)) return json(res, 400, { error: 'Cambio inválido.' });
      entry.status = body.status; if (body.status === 'completed') entry.completedAt = Date.now(); writeDb(entries); return json(res, 200, { entry });
    }
    const remove = url.pathname.match(/^\/api\/admin\/entry\/([\w-]+)$/);
    if (req.method === 'DELETE' && remove) {
      if (!isAdmin(req)) return json(res, 401, { error: 'No autorizado' });
      const entries = readDb(); const next = entries.filter(e => e.id !== remove[1]); writeDb(next); return json(res, 204, {});
    }
    json(res, 404, { error: 'Ruta no encontrada' });
  } catch (err) { json(res, 500, { error: err.message || 'Error del servidor' }); }
});
server.listen(PORT, () => console.log(`WaitList VIP lista en http://localhost:${PORT}`));
