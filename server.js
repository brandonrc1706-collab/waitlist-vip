const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambia-esta-contrasena';
const root = __dirname;
const dbPath = path.join(root, 'data', 'appointments.json');
const sessions = new Set();
const HOURS = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const SERVICES = [
  { id: 'clasico', name: 'Corte Clásico', price: 12, minutes: 30 },
  { id: 'fade', name: 'Fade / Degradado', price: 15, minutes: 45 },
  { id: 'barba', name: 'Corte + Barba', price: 20, minutes: 60 },
  { id: 'premium', name: 'Servicio Premium', price: 25, minutes: 75 }
];

function ensureDb() { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '[]'); }
function readDb() { ensureDb(); try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch { return []; } }
function writeDb(items) { ensureDb(); fs.writeFileSync(dbPath, JSON.stringify(items, null, 2)); }
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function parseBody(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 100000) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Datos inválidos.')); } }); }); }
function isAdmin(req) { const match = (req.headers.cookie || '').match(/booking_session=([^;]+)/); return Boolean(match && sessions.has(match[1])); }
function serveFile(res, file) { fs.readFile(path.join(root, 'public', file), (err, data) => { if (err) return json(res, 404, { error: 'Página no encontrada.' }); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(data); }); }
function summary(items) { const active = items.filter(x => x.status !== 'cancelled'); return { total: active.length, today: active.filter(x => x.date === new Date().toISOString().slice(0, 10)).length, completed: items.filter(x => x.status === 'completed').length }; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && ['/', '/index.html'].includes(url.pathname)) return serveFile(res, 'index.html');
    if (req.method === 'GET' && url.pathname === '/admin.html') return serveFile(res, 'admin.html');
    if (req.method === 'GET' && url.pathname === '/display.html') return serveFile(res, 'display.html');
    if (req.method === 'GET' && url.pathname === '/api/services') return json(res, 200, { services: SERVICES, hours: HOURS });
    if (req.method === 'GET' && url.pathname === '/api/availability') {
      const date = String(url.searchParams.get('date') || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Selecciona una fecha válida.' });
      const taken = readDb().filter(x => x.date === date && x.status !== 'cancelled').map(x => x.time);
      return json(res, 200, { date, hours: HOURS.map(time => ({ time, available: !taken.includes(time) })) });
    }
    if (req.method === 'POST' && url.pathname === '/api/bookings') {
      const body = await parseBody(req); const name = String(body.name || '').trim().slice(0, 60); const phone = String(body.phone || '').trim().slice(0, 30);
      const date = String(body.date || ''); const time = String(body.time || ''); const service = SERVICES.find(x => x.id === body.serviceId);
      if (!name || !phone || !service || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !HOURS.includes(time)) return json(res, 400, { error: 'Completa nombre, teléfono, fecha, hora y corte.' });
      const items = readDb(); if (items.some(x => x.date === date && x.time === time && x.status !== 'cancelled')) return json(res, 409, { error: 'Esa hora ya fue reservada. Escoge otra disponible.' });
      const booking = { id: crypto.randomUUID(), name, phone, date, time, serviceId: service.id, service: service.name, price: service.price, minutes: service.minutes, status: 'confirmed', createdAt: Date.now() };
      items.push(booking); writeDb(items); return json(res, 201, { booking });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const body = await parseBody(req); const supplied = Buffer.from(String(body.password || '')); const expected = Buffer.from(ADMIN_PASSWORD);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return json(res, 401, { error: 'Contraseña incorrecta.' });
      const token = crypto.randomUUID(); sessions.add(token); res.writeHead(204, { 'Set-Cookie': `booking_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/bookings') { if (!isAdmin(req)) return json(res, 401, { error: 'No autorizado.' }); const items = readDb(); return json(res, 200, { bookings: items.sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)), summary: summary(items) }); }
    const bookingRoute = url.pathname.match(/^\/api\/admin\/bookings\/([\w-]+)$/);
    if (bookingRoute && req.method === 'PATCH') { if (!isAdmin(req)) return json(res, 401, { error: 'No autorizado.' }); const body = await parseBody(req); const items = readDb(); const booking = items.find(x => x.id === bookingRoute[1]); if (!booking || !['confirmed', 'completed', 'cancelled'].includes(body.status)) return json(res, 400, { error: 'Cambio inválido.' }); booking.status = body.status; writeDb(items); return json(res, 200, { booking }); }
    json(res, 404, { error: 'Ruta no encontrada.' });
  } catch (error) { json(res, 500, { error: error.message || 'Error del servidor.' }); }
});
server.listen(PORT, () => console.log(`Reservas listas en http://localhost:${PORT}`));
