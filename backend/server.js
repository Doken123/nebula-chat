const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-ganti-di-produksi';
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// ===== DATABASE =====
let dbPath = 'nebulachat.db';
if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  const dir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, 'nebulachat.db');
}

console.log('📁 Database path:', dbPath);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (from_id) REFERENCES users(id),
    FOREIGN KEY (to_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(from_id, to_id, created_at);
`);

// ===== EXPRESS =====
const app = express();

const allowedOrigins = FRONTEND_URL === '*'
  ? true
  : FRONTEND_URL.split(',').map(u => u.trim());

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    app: 'NebulaChat Backend',
    time: new Date().toISOString()
  });
});

// Middleware auth
function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Belum login' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.uid;
    next();
  } catch {
    res.status(401).json({ error: 'Token tidak valid' });
  }
}

// ===== AUTH =====
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username & password wajib' });

  const uname = String(username).toLowerCase().trim();
  if (!/^[a-z0-9_]{3,15}$/.test(uname))
    return res.status(400).json({ error: 'Username: 3-15 karakter (huruf kecil/angka/_)' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password minimal 6 karakter' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (exists) return res.status(400).json({ error: 'Username sudah dipakai' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(uname, hash);
  const uid = info.lastInsertRowid;

  const token = jwt.sign({ uid }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 7 * 24 * 3600 * 1000
  });
  res.json({ ok: true, user: { id: uid, username: uname } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if (!user) return res.status(400).json({ error: 'Username atau password salah' });
  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(400).json({ error: 'Username atau password salah' });

  const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 7 * 24 * 3600 * 1000
  });
  res.json({ ok: true, user: { id: user.id, username: user.username } });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { sameSite: 'none', secure: true });
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
  res.json({ user });
});

// ===== USERS =====
app.get('/api/users', authMiddleware, (req, res) => {
  const users = db.prepare('SELECT id, username FROM users WHERE id != ? ORDER BY username').all(req.userId);
  res.json({ users });
});

// ===== MESSAGES =====
app.get('/api/messages/:otherId', authMiddleware, (req, res) => {
  const otherId = Number(req.params.otherId);
  const rows = db.prepare(`
    SELECT id, from_id, to_id, text, created_at
    FROM messages
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
    ORDER BY created_at ASC
  `).all(req.userId, otherId, otherId, req.userId);
  res.json({ messages: rows });
});

app.post('/api/messages', authMiddleware, (req, res) => {
  const { to, text } = req.body || {};
  if (!to || !text || !String(text).trim())
    return res.status(400).json({ error: 'Pesan kosong' });

  const toId = Number(to);
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(toId);
  if (!target) return res.status(400).json({ error: 'User tidak ditemukan' });

  const info = db.prepare('INSERT INTO messages (from_id, to_id, text) VALUES (?, ?, ?)')
    .run(req.userId, toId, String(text).slice(0, 2000));

  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);

  broadcastToUser(toId, { type: 'new_message', message: msg });
  broadcastToUser(req.userId, { type: 'new_message', message: msg });

  res.json({ ok: true, message: msg });
});

// ===== HTTP + WS =====
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const onlineUsers = new Map();

wss.on('connection', (ws, req) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.token;
  let userId = null;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    userId = payload.uid;
  } catch {
    ws.close(4001, 'Unauthorized');
    return;
  }

  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(ws);
  broadcastPresence();

  ws.on('close', () => {
    const set = onlineUsers.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) onlineUsers.delete(userId);
    }
    broadcastPresence();
  });
});

function broadcastToUser(userId, payload) {
  const set = onlineUsers.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  set.forEach(ws => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
}

function broadcastPresence() {
  const ids = Array.from(onlineUsers.keys());
  const payload = JSON.stringify({ type: 'presence', online: ids });
  onlineUsers.forEach(set => {
    set.forEach(ws => {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    });
  });
}

function parseCookies(str) {
  return str.split(';').reduce((acc, c) => {
    const [k, ...v] = c.trim().split('=');
    if (k) acc[k] = decodeURIComponent(v.join('='));
    return acc;
  }, {});
}

server.listen(PORT, () => {
  console.log(`🌌 NebulaChat Backend jalan di port ${PORT}`);
});
