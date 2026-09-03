// ============================================================
// CHAQIR — Backend server (Express + better-sqlite3), API-only
// Local test: `node server.js` -> http://localhost:3000
// Ngrok orqali tashqariga: ngrok http --url=YOUR-STATIC-DOMAIN 3000
//
// Frontend ALOHIDA joyda (boshqa repo/hosting) turadi va shu serverga
// API orqali (masalan ngrok domeni orqali) ulanadi. Bu server faqat
// /api/* endpoint'larni beradi — statik fayl xizmat qilmaydi.
// ============================================================

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SESSION_TTL_DAYS = 30;

// ------------------------------------------------------------
// CORS — .env ichida ALLOWED_ORIGIN bilan cheklaymiz (ngrok domain,
// yoki local test uchun *). Agar ALLOWED_ORIGIN bo'sh bo'lsa — hammaga
// ochiq (faqat local dev uchun xavfsiz, productionda albatta to'ldir).
// ------------------------------------------------------------
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin }));
app.use(express.json());

// Har bir so'rovni log qilamiz — ngrok orqali kelayotganini terminalda
// ko'rish uchun (debug qulayligi).
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
function getWorkerFull(workerId) {
  const worker = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(workerId, 'worker');
  if (!worker) return null;

  const skills = db.prepare(`
    SELECT skill_id AS id FROM worker_skills WHERE worker_id = ?
  `).all(workerId).map(r => r.id);

  const portfolio = db.prepare('SELECT url, caption FROM portfolio_items WHERE worker_id = ?').all(workerId);
  const reviews = db.prepare('SELECT author, rating, text FROM reviews WHERE worker_id = ? ORDER BY id DESC').all(workerId);

  return {
    id: worker.id,
    name: worker.name,
    phone: worker.phone,
    region: worker.region,
    district: worker.district,
    mahalla: worker.mahalla,
    address: worker.address,
    avatarColor: worker.avatar_color,
    rating: worker.rating,
    reviewCount: worker.review_count,
    skills,
    portfolio,
    reviews
  };
}

// ------------------------------------------------------------
// AUTH — session yaratish/tekshirish, Telegram initData verifikatsiyasi
// ------------------------------------------------------------
function createSession(userId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return { token, expiresAt };
}

function publicUser(user) {
  const base = {
    id: user.id,
    role: user.role,
    name: user.name,
    phone: user.phone,
    region: user.region,
    district: user.district,
    mahalla: user.mahalla,
    address: user.address,
    rating: user.rating || 0,
    reviewCount: user.review_count || 0
  };
  if (user.role === 'worker') {
    base.skills = db.prepare('SELECT skill_id AS id FROM worker_skills WHERE worker_id = ?').all(user.id).map(r => r.id);
  }
  return base;
}

// Telegram Mini App initData tekshiruvi (rasmiy HMAC-SHA256 sxemasi).
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    return JSON.parse(userRaw); // { id, first_name, last_name, username, ... }
  } catch {
    return null;
  }
}

// req.userId / req.userRole to'ldiradi, token yo'q/eskirgan bo'lsa 401
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });

  const session = db.prepare(`
    SELECT s.*, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token);

  if (!session) return res.status(401).json({ error: 'Sessiya topilmadi' });
  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Sessiya muddati tugagan' });
  }

  req.userId = session.user_id;
  req.userRole = session.role;
  next();
}

// Telegram initData orqali kirish. Agar telegram_id bo'yicha user topilsa —
// session qaytaradi. Topilmasa 404 (frontend ro'yxatdan o'tishga yo'naltiradi).
app.post('/api/auth/telegram', (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ error: 'Serverda TELEGRAM_BOT_TOKEN sozlanmagan' });
  }
  const { initData } = req.body;
  if (!initData) return res.status(400).json({ error: 'initData majburiy' });

  const tgUser = verifyTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: 'initData tekshiruvidan o\'tmadi' });

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(tgUser.id));
  if (!user) return res.status(404).json({ error: 'Bu Telegram hisobi bilan foydalanuvchi topilmadi', telegramId: String(tgUser.id) });

  const { token, expiresAt } = createSession(user.id);
  res.json({ token, expiresAt, user: publicUser(user) });
});

// Telefon + parol bilan kirish (brauzer-demo fallback).
// Bir raqamda 2 ta hisob (worker + employer) bo'lishi mumkin:
// - userId yuborilmasa va 2+ mos hisob topilsa → needsChoice + accounts
// - userId yuborilsa yoki faqat 1 ta mos bo'lsa → token + user
app.post('/api/auth/login', (req, res) => {
  const { phone, password, userId } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: 'phone va password majburiy' });

  const candidates = db.prepare('SELECT * FROM users WHERE phone = ?').all(String(phone).trim());
  const matched = candidates.filter(u => u.password_hash && bcrypt.compareSync(password, u.password_hash));

  if (matched.length === 0) {
    return res.status(401).json({ error: 'Telefon raqam yoki parol noto\'g\'ri' });
  }

  // Aniq hisob tanlangan (ikkilamchi so'rov yoki bitta hisob)
  if (userId != null && userId !== '') {
    const picked = matched.find(u => String(u.id) === String(userId));
    if (!picked) {
      return res.status(401).json({ error: 'Telefon raqam yoki parol noto\'g\'ri' });
    }
    const { token, expiresAt } = createSession(picked.id);
    return res.json({ token, expiresAt, user: publicUser(picked) });
  }

  if (matched.length === 1) {
    const user = matched[0];
    const { token, expiresAt } = createSession(user.id);
    return res.json({ token, expiresAt, user: publicUser(user) });
  }

  // Bir nechta hisob — foydalanuvchi tanlashi kerak
  res.json({
    needsChoice: true,
    accounts: matched.map(u => ({
      id: u.id,
      role: u.role,
      name: u.name,
      phone: u.phone
    }))
  });
});

// Joriy tokenga tegishli foydalanuvchini qaytaradi (F5'dan keyin ham kirgan holatda qolish uchun)
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  res.json(publicUser(user));
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.status(204).end();
});

// ------------------------------------------------------------

// ------------------------------------------------------------
// OTP — telefon tasdiqlash (hozir Telegram bot orqali, keyinroq SMS)
// Telegram Bot API istalgan raqamni qidirib topa olmaydi:
//   1) Mini App'dan kelgan telegram_id
//   2) Shu raqam bilan oldin ro'yxatdan o'tgan user.telegram_id
//   3) Aks holda DEMO: kod javobda qaytariladi (web test)
// ------------------------------------------------------------
const OTP_TTL_SEC = 5 * 60;
const OTP_DEMO = process.env.OTP_DEMO !== '0'; // default: demo kodni response'da ko'rsat

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 raqam
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN yo\'q' };
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description || 'Telegram yuborilmadi' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Telegram tarmoq xatosi' };
  }
}

function resolveTelegramIdForPhone(phone, bodyTelegramId) {
  if (bodyTelegramId) return String(bodyTelegramId);
  const row = db.prepare(
    "SELECT telegram_id FROM users WHERE phone = ? AND telegram_id IS NOT NULL AND telegram_id != '' LIMIT 1"
  ).get(phone);
  return row ? String(row.telegram_id) : null;
}

app.post('/api/auth/otp/send', async (req, res) => {
  const { phone, telegram_id } = req.body || {};
  if (!phone || String(phone).trim().length < 9) {
    return res.status(400).json({ error: 'phone majburiy' });
  }
  const normalized = String(phone).trim();

  // Rate limit: oxirgi 60 soniyada yuborilgan bo'lsa kutish
  const recent = db.prepare(`
    SELECT id, created_at FROM phone_otps
    WHERE phone = ? AND used_at IS NULL
      AND created_at > datetime('now', '-60 seconds')
    ORDER BY id DESC LIMIT 1
  `).get(normalized);
  if (recent) {
    return res.status(429).json({ error: 'Kod allaqachon yuborildi. 1 daqiqa kuting.' });
  }

  // Eski kodlarni bekor qilish (shu telefon)
  db.prepare(`UPDATE phone_otps SET used_at = datetime('now') WHERE phone = ? AND used_at IS NULL`).run(normalized);

  const code = generateOtpCode();
  const codeHash = bcrypt.hashSync(code, 8);
  const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000).toISOString();
  const tgId = resolveTelegramIdForPhone(normalized, telegram_id);

  db.prepare(`
    INSERT INTO phone_otps (phone, code_hash, telegram_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(normalized, codeHash, tgId, expiresAt);

  let channel = 'demo';
  let sendError = null;

  if (tgId && TELEGRAM_BOT_TOKEN) {
    const text =
      `<b>Chaqir</b> tasdiqlash kodi: <code>${code}</code>\n` +
      `Kod 5 daqiqa amal qiladi. Hech kimga bermang.`;
    const sent = await sendTelegramMessage(tgId, text);
    if (sent.ok) {
      channel = 'telegram';
    } else {
      sendError = sent.error;
      console.warn('OTP Telegram yuborish xatosi:', sent.error);
    }
  }

  // Demo: Telegram topilmasa yoki yuborilmasa — kodni response'da qaytaramiz (test)
  const payload = {
    ok: true,
    channel, // 'telegram' | 'demo'
    expiresIn: OTP_TTL_SEC,
    message: channel === 'telegram'
      ? 'Kod Telegram hisobingizga yuborildi'
      : 'Telegram orqali yuborib bo\'lmadi — demo kod qaytarildi'
  };
  if (channel !== 'telegram' || OTP_DEMO) {
    // Web/test: har doim demo kodni ko'rsatish mumkin (OTP_DEMO=0 bo'lsa faqat telegram muvaffaqiyatsizida)
    if (channel !== 'telegram') {
      payload.demoCode = code;
    }
  }
  if (sendError) payload.sendError = sendError;
  console.log(`[OTP] phone=${normalized} channel=${channel} code=${code} tg=${tgId || '-'}`);
  res.json(payload);
});

app.post('/api/auth/otp/verify', (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'phone va code majburiy' });
  const normalized = String(phone).trim();
  const rawCode = String(code).trim().replace(/\s/g, '');

  const row = db.prepare(`
    SELECT * FROM phone_otps
    WHERE phone = ? AND used_at IS NULL
    ORDER BY id DESC LIMIT 1
  `).get(normalized);

  if (!row) return res.status(400).json({ error: 'Kod topilmadi. Qayta yuboring.' });
  if (row.expires_at < new Date().toISOString()) {
    return res.status(400).json({ error: 'Kod muddati tugagan. Qayta yuboring.' });
  }
  if (row.attempts >= 5) {
    return res.status(429).json({ error: 'Juda ko\'p urinish. Yangi kod so\'rang.' });
  }

  db.prepare('UPDATE phone_otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);

  if (!bcrypt.compareSync(rawCode, row.code_hash)) {
    return res.status(401).json({ error: 'Kod noto\'g\'ri' });
  }

  db.prepare(`UPDATE phone_otps SET used_at = datetime('now') WHERE id = ?`).run(row.id);
  res.json({ ok: true, phone: normalized, verified: true });
});


// AUTH TRANSFER — Telegram Mini App sessiyasini brauzerga ko'chirish
// Mini App ichida: POST /api/auth/transfer → { code, expiresIn }
// Brauzer: POST /api/auth/transfer/consume { code } → { token, user }
// Kod 10 soniya, bir marta (atomar UPDATE). Muddati o'tsa login bo'lmaydi — faqat toza URL.
// ------------------------------------------------------------
app.post('/api/auth/transfer', requireAuth, (req, res) => {
  const code = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 1000).toISOString(); // 10 soniya
  db.prepare(
    'INSERT INTO transfer_codes (code, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(code, req.userId, expiresAt);
  db.prepare("DELETE FROM transfer_codes WHERE expires_at < datetime('now') OR used_at IS NOT NULL").run();
  res.status(201).json({ code, expiresIn: 10 });
});

app.post('/api/auth/transfer/consume', (req, res) => {
  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code majburiy' });
  }
  const c = code.trim();
  // Atomar: faqat hali ishlatilmagan va muddati o'tmagan kodni "yutadi"
  const result = db.prepare(`
    UPDATE transfer_codes
    SET used_at = datetime('now')
    WHERE code = ?
      AND used_at IS NULL
      AND expires_at > datetime('now')
  `).run(c);

  if (result.changes === 0) {
    const row = db.prepare('SELECT used_at, expires_at FROM transfer_codes WHERE code = ?').get(c);
    if (!row) return res.status(404).json({ error: 'Kod topilmadi' });
    if (row.used_at) return res.status(410).json({ error: 'Kod allaqachon ishlatilgan' });
    return res.status(410).json({ error: 'Kod muddati tugagan' });
  }

  const owned = db.prepare('SELECT user_id FROM transfer_codes WHERE code = ?').get(c);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(owned.user_id);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  const { token, expiresAt } = createSession(user.id);
  res.json({ token, expiresAt, user: publicUser(user) });
});

// ------------------------------------------------------------
// PROFILE — joriy foydalanuvchi ma'lumotlarini yangilash
// ------------------------------------------------------------
app.patch('/api/me', requireAuth, (req, res) => {
  const { name, phone, region, district, mahalla, address, skills, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  const nextName = name != null ? String(name).trim() : user.name;
  const nextPhone = phone != null ? String(phone).trim() : user.phone;
  if (!nextName || !nextPhone) return res.status(400).json({ error: 'name va phone majburiy' });

  let passwordHash = user.password_hash;
  if (password != null && String(password).length > 0) {
    if (String(password).length < 4) return res.status(400).json({ error: 'Parol kamida 4 belgi' });
    passwordHash = bcrypt.hashSync(String(password), 10);
  }

  try {
    db.prepare(`UPDATE users SET
      name = ?, phone = ?, region = ?, district = ?, mahalla = ?, address = ?, password_hash = ?
      WHERE id = ?`).run(
      nextName,
      nextPhone,
      region != null ? region : user.region,
      district != null ? district : user.district,
      mahalla != null ? mahalla : user.mahalla,
      address != null ? address : user.address,
      passwordHash,
      req.userId
    );
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Bu telefon raqam band' });
    }
    return res.status(500).json({ error: e.message });
  }

  if (user.role === 'worker' && Array.isArray(skills)) {
    db.prepare('DELETE FROM worker_skills WHERE worker_id = ?').run(req.userId);
    const ins = db.prepare('INSERT OR IGNORE INTO worker_skills (worker_id, skill_id) VALUES (?, ?)');
    for (const s of skills) {
      if (s) ins.run(req.userId, s);
    }
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json(publicUser(updated));
});

// Portfolio qo'shish (faqat o'z profiliga)
app.post('/api/workers/:id/portfolio', requireAuth, (req, res) => {
  const workerId = Number(req.params.id);
  if (String(workerId) !== String(req.userId)) {
    return res.status(403).json({ error: 'Faqat o\'z portfolioingizga rasm qo\'sha olasiz' });
  }
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(workerId);
  if (!user || user.role !== 'worker') return res.status(404).json({ error: 'Ishchi topilmadi' });

  const { url, caption } = req.body || {};
  if (!url || !String(url).trim()) return res.status(400).json({ error: 'url majburiy' });
  const safeUrl = String(url).trim();
  if (!/^https?:\/\//i.test(safeUrl)) {
    return res.status(400).json({ error: 'url http(s) bilan boshlanishi kerak' });
  }
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO portfolio_items (worker_id, url, caption) VALUES (?, ?, ?)'
  ).run(workerId, safeUrl, caption ? String(caption).trim() : '');
  res.status(201).json({ id: lastInsertRowid, url: safeUrl, caption: caption || '' });
});

app.delete('/api/workers/:id/portfolio/:itemId', requireAuth, (req, res) => {
  const workerId = Number(req.params.id);
  if (String(workerId) !== String(req.userId)) {
    return res.status(403).json({ error: 'Ruxsat yo\'q' });
  }
  const item = db.prepare('SELECT * FROM portfolio_items WHERE id = ? AND worker_id = ?')
    .get(req.params.itemId, workerId);
  if (!item) return res.status(404).json({ error: 'Rasm topilmadi' });
  db.prepare('DELETE FROM portfolio_items WHERE id = ?').run(req.params.itemId);
  res.status(204).end();
});

// Sharh yozish (employer ishchiga)
app.post('/api/workers/:id/reviews', requireAuth, (req, res) => {
  const workerId = Number(req.params.id);
  if (String(workerId) === String(req.userId)) {
    return res.status(400).json({ error: 'O\'zingizga sharh yoza olmaysiz' });
  }
  const worker = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(workerId, 'worker');
  if (!worker) return res.status(404).json({ error: 'Ishchi topilmadi' });

  const me = db.prepare('SELECT name, role FROM users WHERE id = ?').get(req.userId);
  if (!me || me.role !== 'employer') {
    return res.status(403).json({ error: 'Faqat ish qidiruvchi sharh yozishi mumkin' });
  }

  const { rating, text } = req.body || {};
  const r = Number(rating);
  if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'rating 1..5 bo\'lishi kerak' });

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO reviews (worker_id, author, rating, text) VALUES (?, ?, ?, ?)'
  ).run(workerId, me.name, r, text ? String(text).trim() : '');

  // rating / review_count ni qayta hisoblash
  const agg = db.prepare(
    'SELECT COUNT(*) AS c, AVG(rating) AS avg FROM reviews WHERE worker_id = ?'
  ).get(workerId);
  db.prepare('UPDATE users SET review_count = ?, rating = ? WHERE id = ?')
    .run(agg.c, Math.round((agg.avg || 0) * 10) / 10, workerId);

  res.status(201).json({ id: lastInsertRowid, author: me.name, rating: r, text: text || '' });
});

// ------------------------------------------------------------
// LOCATION: regions / districts / mahallas
// ------------------------------------------------------------
app.get('/api/regions', (req, res) => {
  const rows = db.prepare('SELECT name FROM regions ORDER BY id').all();
  res.json(rows.map(r => r.name));
});

app.get('/api/districts', (req, res) => {
  const { region } = req.query;
  if (!region) return res.status(400).json({ error: 'region query param kerak' });
  const rows = db.prepare(`
    SELECT d.name FROM districts d
    JOIN regions r ON r.id = d.region_id
    WHERE r.name = ? ORDER BY d.id
  `).all(region);
  res.json(rows.map(r => r.name));
});

app.get('/api/mahallas', (req, res) => {
  const { district } = req.query;
  if (!district) return res.status(400).json({ error: 'district query param kerak' });
  const rows = db.prepare(`
    SELECT m.name FROM mahallas m
    JOIN districts d ON d.id = m.district_id
    WHERE d.name = ? ORDER BY m.id
  `).all(district);
  res.json(rows.map(r => r.name));
});

// ------------------------------------------------------------
// SKILLS
// ------------------------------------------------------------
app.get('/api/skills', (req, res) => {
  const rows = db.prepare('SELECT id, label, icon FROM skills ORDER BY rowid').all();
  res.json(rows);
});

// ------------------------------------------------------------
// WORKERS (search / feed / detail)
// GET /api/workers?skills=Santexnika,Elektrika&region=...&district=...&q=...
// ------------------------------------------------------------
app.get('/api/workers', (req, res) => {
  const { skills, region, district, q } = req.query;

  let sql = `SELECT DISTINCT u.* FROM users u`;
  const conditions = [`u.role = 'worker'`];
  const params = [];

  if (skills) {
    const skillList = skills.split(',').map(s => s.trim()).filter(Boolean);
    if (skillList.length) {
      sql += ` JOIN worker_skills ws ON ws.worker_id = u.id`;
      conditions.push(`ws.skill_id IN (${skillList.map(() => '?').join(',')})`);
      params.push(...skillList);
    }
  }
  if (region) { conditions.push('u.region = ?'); params.push(region); }
  if (district) { conditions.push('u.district = ?'); params.push(district); }
  if (q) { conditions.push('u.name LIKE ?'); params.push(`%${q}%`); }

  sql += ' WHERE ' + conditions.join(' AND ') + ' ORDER BY u.rating DESC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(w => getWorkerFull(w.id)));
});

app.get('/api/workers/:id', (req, res) => {
  const worker = getWorkerFull(Number(req.params.id));
  if (!worker) return res.status(404).json({ error: 'Ishchi topilmadi' });
  res.json(worker);
});

// Worker ro'yxatdan o'tish
app.post('/api/workers', (req, res) => {
  const { name, phone, region, district, mahalla, address, skills, password, telegram_id } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name va phone majburiy' });

  // Bir raqamda bir xil role takrorlanmasin (worker + employer alohida ruxsat)
  if (phone) {
    const exists = db.prepare("SELECT id FROM users WHERE phone = ? AND role = 'worker'").get(String(phone).trim());
    if (exists) return res.status(409).json({ error: 'Bu telefon raqam bilan ishchi hisobi allaqachon bor' });
  }

  // Parol: yangi berilsa hash; yo'q lekin shu raqamda boshqa hisobda parol bo'lsa — nusxa;
  // umuman yo'q bo'lsa — majburiy (409 emas, 400).
  let passwordHash = null;
  if (password && String(password).length > 0) {
    if (String(password).length < 4) return res.status(400).json({ error: 'Parol kamida 4 belgi' });
    passwordHash = bcrypt.hashSync(String(password), 10);
  } else if (phone) {
    const sibling = db.prepare(
      "SELECT password_hash FROM users WHERE phone = ? AND password_hash IS NOT NULL AND password_hash != '' LIMIT 1"
    ).get(String(phone).trim());
    if (sibling) passwordHash = sibling.password_hash;
  }
  if (!passwordHash) {
    return res.status(400).json({ error: 'Parol majburiy' });
  }

  const insertUser = db.prepare(`
    INSERT INTO users (role, name, phone, region, district, mahalla, address, password_hash, telegram_id)
    VALUES ('worker', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    const { lastInsertRowid } = insertUser.run(
      name, phone, region || null, district || null, mahalla || null, address || '',
      passwordHash, telegram_id ? String(telegram_id) : null
    );
    const insertWorkerSkill = db.prepare('INSERT INTO worker_skills (worker_id, skill_id) VALUES (?, ?)');
    for (const skillId of (skills || [])) {
      insertWorkerSkill.run(lastInsertRowid, skillId);
    }
    const { token, expiresAt } = createSession(lastInsertRowid);
    res.status(201).json({ ...getWorkerFull(lastInsertRowid), token, expiresAt });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Bu telefon raqam yoki Telegram hisob bilan foydalanuvchi allaqachon bor' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------------
// EMPLOYERS — ro'yxatdan o'tish
// ------------------------------------------------------------
app.post('/api/employers', (req, res) => {
  const { name, phone, region, district, mahalla, address, password, telegram_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name majburiy' });

  if (phone) {
    const exists = db.prepare("SELECT id FROM users WHERE phone = ? AND role = 'employer'").get(String(phone).trim());
    if (exists) return res.status(409).json({ error: 'Bu telefon raqam bilan ish qidiruvchi hisobi allaqachon bor' });
  }

  let passwordHash = null;
  if (password && String(password).length > 0) {
    if (String(password).length < 4) return res.status(400).json({ error: 'Parol kamida 4 belgi' });
    passwordHash = bcrypt.hashSync(String(password), 10);
  } else if (phone) {
    const sibling = db.prepare(
      "SELECT password_hash FROM users WHERE phone = ? AND password_hash IS NOT NULL AND password_hash != '' LIMIT 1"
    ).get(String(phone).trim());
    if (sibling) passwordHash = sibling.password_hash;
  }
  if (!passwordHash) {
    return res.status(400).json({ error: 'Parol majburiy' });
  }

  const insertUser = db.prepare(`
    INSERT INTO users (role, name, phone, region, district, mahalla, address, password_hash, telegram_id)
    VALUES ('employer', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    const { lastInsertRowid } = insertUser.run(
      name, phone || null, region || null, district || null, mahalla || null, address || '',
      passwordHash, telegram_id ? String(telegram_id) : null
    );
    const { token, expiresAt } = createSession(lastInsertRowid);
    res.status(201).json({ id: lastInsertRowid, name, phone, region, district, mahalla, address, token, expiresAt });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Bu telefon raqam yoki Telegram hisob bilan foydalanuvchi allaqachon bor' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------------
// USERS — telefon bo'yicha qidirish (oddiy "kirish" uchun, parolsiz —
// demo maqsadida: foydalanuvchi avval ro'yxatdan o'tgan bo'lsa, shu
// endpoint orqali uning id/role/name'i topiladi va qayta ro'yxatdan
// o'tishga hojat qolmaydi)
// ------------------------------------------------------------
// Telefon holati: boshqa role ochishda parol so'rash kerakmi?
// hasPassword=true → shu raqamda allaqachon parol bor, yangi hisobda qayta so'ralmasin
app.get('/api/users/phone-status/:phone', (req, res) => {
  const phone = decodeURIComponent(req.params.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'phone majburiy' });
  const users = db.prepare(
    'SELECT id, role, name, password_hash FROM users WHERE phone = ?'
  ).all(phone);
  const hasPassword = users.some(u => u.password_hash);
  res.json({
    exists: users.length > 0,
    hasPassword,
    roles: users.map(u => u.role),
    accounts: users.map(u => ({ id: u.id, role: u.role, name: u.name }))
  });
});

app.get('/api/users/by-phone/:phone', (req, res) => {
  const users = db.prepare(
    'SELECT id, role, name, phone, region, district, mahalla, address FROM users WHERE phone = ?'
  ).all(req.params.phone);
  if (!users.length) return res.status(404).json({ error: 'Bu raqam bilan foydalanuvchi topilmadi' });
  // Bitta bo'lsa eski format (obyekt), bir nechta bo'lsa massiv — moslik uchun
  res.json(users.length === 1 ? users[0] : users);
});

// ------------------------------------------------------------
// FAVORITES
// ------------------------------------------------------------
// Har uch endpoint ham requireAuth bilan yopilgan va :employerId
// so'ralayotgan token egasiga tegishli ekani tekshiriladi — aks holda
// xohlagan kishi boshqa employer'ning sevimlilarini o'qishi/o'zgartirishi
// mumkin bo'lib qolardi.
function checkOwnEmployerId(req, res) {
  if (String(req.userId) !== String(req.params.employerId)) {
    res.status(403).json({ error: 'Boshqa foydalanuvchining ma\'lumotiga ruxsat yo\'q' });
    return false;
  }
  return true;
}

app.get('/api/employers/:employerId/favorites', requireAuth, (req, res) => {
  if (!checkOwnEmployerId(req, res)) return;
  const rows = db.prepare(`
    SELECT worker_id FROM favorites WHERE employer_id = ?
  `).all(req.params.employerId);
  res.json(rows.map(r => getWorkerFull(r.worker_id)));
});

app.post('/api/employers/:employerId/favorites/:workerId', requireAuth, (req, res) => {
  if (!checkOwnEmployerId(req, res)) return;
  db.prepare('INSERT OR IGNORE INTO favorites (employer_id, worker_id) VALUES (?, ?)')
    .run(req.params.employerId, req.params.workerId);
  res.status(204).end();
});

app.delete('/api/employers/:employerId/favorites/:workerId', requireAuth, (req, res) => {
  if (!checkOwnEmployerId(req, res)) return;
  db.prepare('DELETE FROM favorites WHERE employer_id = ? AND worker_id = ?')
    .run(req.params.employerId, req.params.workerId);
  res.status(204).end();
});

// ------------------------------------------------------------
// ORDERS
// ------------------------------------------------------------
// worker_id YOKI employer_id bilan so'ralishi mumkin — har ikkalasi ham
// token egasiga (req.userId) mos kelishi kerak, aks holda boshqa
// foydalanuvchining buyurtmalarini query orqali o'qib bo'lmaydi.
// - worker_id: shu workerga kelgan buyurtmalar ("Buyurtmalar" tab, worker tarafida)
// - employer_id: shu employer yuborgan so'rovlar va ularning holati (3.1, ixtiyoriy)
app.get('/api/orders', requireAuth, (req, res) => {
  const { worker_id, employer_id } = req.query;
  if (!worker_id && !employer_id) {
    return res.status(400).json({ error: 'worker_id yoki employer_id query param kerak' });
  }

  if (worker_id) {
    if (String(worker_id) !== String(req.userId)) {
      return res.status(403).json({ error: 'Boshqa foydalanuvchining buyurtmalariga ruxsat yo\'q' });
    }
    const rows = db.prepare(`
      SELECT id, client_name AS clientName, skill, mahalla, status, created_at AS date
      FROM orders WHERE worker_id = ? ORDER BY id DESC
    `).all(worker_id);
    return res.json(rows);
  }

  if (String(employer_id) !== String(req.userId)) {
    return res.status(403).json({ error: 'Boshqa foydalanuvchining so\'rovlariga ruxsat yo\'q' });
  }
  const rows = db.prepare(`
    SELECT o.id, o.worker_id AS workerId, u.name AS workerName, o.skill, o.mahalla,
           o.status, o.created_at AS date
    FROM orders o JOIN users u ON u.id = o.worker_id
    WHERE o.employer_id = ? ORDER BY o.id DESC
  `).all(employer_id);
  res.json(rows);
});

// client_name va employer_id endi body'dan emas — token egasining
// users.name/id'idan olinadi, shunda employer o'zini boshqa ism bilan
// yubora olmaydi va so'rovi keyinchalik o'ziga bog'lanadi (3.1).
app.post('/api/orders', requireAuth, (req, res) => {
  const { worker_id, skill, mahalla } = req.body;
  if (!worker_id) return res.status(400).json({ error: 'worker_id majburiy' });

  const employer = db.prepare('SELECT name FROM users WHERE id = ?').get(req.userId);
  if (!employer) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO orders (worker_id, employer_id, client_name, skill, mahalla) VALUES (?, ?, ?, ?, ?)
  `).run(worker_id, req.userId, employer.name, skill || null, mahalla || null);
  res.status(201).json({ id: lastInsertRowid });
});

// Faqat buyurtma egasi (shu worker) statusni o'zgartira oladi.
app.patch('/api/orders/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['yangi', 'bajarilgan', 'bekor'].includes(status)) {
    return res.status(400).json({ error: 'status: yangi | bajarilgan | bekor' });
  }
  const order = db.prepare('SELECT worker_id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (String(order.worker_id) !== String(req.userId)) {
    return res.status(403).json({ error: 'Bu buyurtmaga ruxsat yo\'q' });
  }
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.status(204).end();
});

// ------------------------------------------------------------
// CONVERSATIONS / MESSAGES
// ------------------------------------------------------------
// Yangi suhbat oching (yoki ikki foydalanuvchi orasida allaqachon bor
// bo'lsa, o'shani qaytaring). user_a_id endi body'dan emas, token
// egasidan olinadi.
app.post('/api/conversations', requireAuth, (req, res) => {
  const user_a_id = req.userId;
  const { user_b_id } = req.body;
  if (!user_b_id) return res.status(400).json({ error: 'user_b_id majburiy' });

  let conv = db.prepare(`
    SELECT * FROM conversations
    WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)
  `).get(user_a_id, user_b_id, user_b_id, user_a_id);

  if (!conv) {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO conversations (user_a_id, user_b_id) VALUES (?, ?)'
    ).run(user_a_id, user_b_id);
    conv = { id: lastInsertRowid };
  }
  res.status(201).json({ id: conv.id });
});

app.get('/api/conversations', requireAuth, (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id query param kerak' });
  if (String(user_id) !== String(req.userId)) {
    return res.status(403).json({ error: 'Boshqa foydalanuvchining suhbatlariga ruxsat yo\'q' });
  }

  const convs = db.prepare(`
    SELECT c.id,
           CASE WHEN c.user_a_id = ? THEN c.user_b_id ELSE c.user_a_id END AS contact_id
    FROM conversations c
    WHERE c.user_a_id = ? OR c.user_b_id = ?
  `).all(user_id, user_id, user_id);

  const result = convs.map(c => {
    const contact = db.prepare('SELECT name, avatar_color FROM users WHERE id = ?').get(c.contact_id);
    const messages = db.prepare(`
      SELECT sender_id, text, created_at FROM messages WHERE conversation_id = ? ORDER BY id
    `).all(c.id);

    // O'qilmagan: men yubormagan va last_read_at dan keyin kelgan xabarlar
    const readRow = db.prepare(
      'SELECT last_read_at FROM conversation_reads WHERE conversation_id = ? AND user_id = ?'
    ).get(c.id, user_id);
    const lastReadAt = readRow ? readRow.last_read_at : null;
    const unreadCount = messages.filter(m => {
      if (String(m.sender_id) === String(user_id)) return false;
      if (!lastReadAt) return true;
      return String(m.created_at) > String(lastReadAt);
    }).length;

    return {
      id: c.id,
      contactName: contact ? contact.name : 'Noma\'lum',
      avatarColor: contact ? contact.avatar_color : '#5B8DEF',
      unreadCount,
      messages: messages.map(m => ({
        from: String(m.sender_id) === String(user_id) ? 'me' : 'them',
        text: m.text,
        time: m.created_at
      }))
    };
  });

  res.json(result);
});

// Suhbatni o'qilgan deb belgilash
app.post('/api/conversations/:id/read', requireAuth, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Suhbat topilmadi' });
  if (String(conv.user_a_id) !== String(req.userId) && String(conv.user_b_id) !== String(req.userId)) {
    return res.status(403).json({ error: 'Bu suhbatga ruxsat yo\'q' });
  }
  db.prepare(`
    INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_at = datetime('now')
  `).run(req.params.id, req.userId);
  res.status(204).end();
});

// sender_id endi body'dan emas, token egasidan olinadi — va u shu
// suhbatning haqiqiy ishtirokchisi ekani tekshiriladi.
app.post('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text majburiy' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Suhbat topilmadi' });
  if (String(conv.user_a_id) !== String(req.userId) && String(conv.user_b_id) !== String(req.userId)) {
    return res.status(403).json({ error: 'Bu suhbatga ruxsat yo\'q' });
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO messages (conversation_id, sender_id, text) VALUES (?, ?, ?)
  `).run(req.params.id, req.userId, text);
  // Yuborgan o'zi o'qigan deb belgilaymiz
  db.prepare(`
    INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_at = datetime('now')
  `).run(req.params.id, req.userId);
  res.status(201).json({ id: lastInsertRowid });
});

// ------------------------------------------------------------
// HEALTH CHECK — ngrok orqali ulanganini tekshirish uchun
// ------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ------------------------------------------------------------
// ROOT — API-only ekanini bildirish uchun oddiy javob
// (frontend endi ALOHIDA joyda, bu yerda statik fayl serve qilinmaydi)
// ------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'CHAQIR API ishlayapti. Frontend alohida joylashgan.' });
});

app.listen(PORT, () => {
  console.log(`[server] CHAQIR backend http://localhost:${PORT} da ishga tushdi`);
  console.log(`[server] Ngrok bilan ulash: ngrok http --url=SENING-DOMAIN 3000`);
});
