// ============================================================
// DB — SQLite (better-sqlite3), local test uchun.
// Fayl: data/chaqir.db. Ishga tushganda schema avtomatik yaratiladi
// (agar mavjud bo'lmasa), keyin agar workers jadvali BO'SH bo'lsa —
// data.js dagi MOCK_* bilan bir xil demo data seed qilinadi.
// ============================================================

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// `data/` papkasi git'da saqlanmaydi (.gitignore), shuning uchun
// birinchi marta klonlanganda/ochilganda mavjud bo'lmasligi mumkin —
// better-sqlite3 papkani o'zi yaratmaydi, shu sababli qo'lda tekshiramiz.
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'chaqir.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS districts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  UNIQUE(name, region_id)
);

CREATE TABLE IF NOT EXISTS mahallas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  district_id INTEGER NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  UNIQUE(name, district_id)
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,       -- masalan "Santexnika"
  label TEXT NOT NULL,
  icon TEXT NOT NULL         -- raw <svg> string
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE,        -- Telegram initDataUnsafe.user.id (bo'lishi mumkin bo'sh, brauzer demo uchun)
  role TEXT NOT NULL CHECK(role IN ('worker','employer')),
  name TEXT NOT NULL,
  phone TEXT,
  region TEXT,
  district TEXT,
  mahalla TEXT,
  address TEXT,
  avatar_color TEXT DEFAULT '#5B8DEF',
  rating REAL DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS worker_skills (
  worker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (worker_id, skill_id)
);

CREATE TABLE IF NOT EXISTS portfolio_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  rating INTEGER NOT NULL,
  text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorites (
  employer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (employer_id, worker_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  skill TEXT,
  mahalla TEXT,
  status TEXT DEFAULT 'yangi' CHECK(status IN ('yangi','bajarilgan','bekor')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_a_id, user_b_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
`);

// ------------------------------------------------------------

// Telefon tasdiqlash (Telegram orqali OTP; keyinroq SMS ham shu jadvaldan)
db.exec(`
CREATE TABLE IF NOT EXISTS phone_otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  telegram_id TEXT,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_phone_otps_phone ON phone_otps(phone);
`);

// MIGRATION: users.password_hash — CREATE TABLE IF NOT EXISTS eski
// jadvalga ustun qo'shmaydi, shu sababli mavjudligini tekshirib,
// bo'lmasa qo'lda ALTER TABLE qilamiz (mavjud bazalar buzilmasligi uchun).
// ------------------------------------------------------------
const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
if (!userColumns.includes('password_hash')) {
  db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
}

// ------------------------------------------------------------
// MIGRATION: orders.employer_id — employer o'zi yuborgan so'rovlarini
// kuzatishi uchun (ROADMAP 3.1). Eski buyurtmalarda NULL qoladi (auth'dan
// oldin yaratilgan bo'lishi mumkin) — bu xavfsiz, chunki ustun ixtiyoriy.
// ------------------------------------------------------------
const orderColumns = db.prepare(`PRAGMA table_info(orders)`).all().map(c => c.name);
if (!orderColumns.includes('employer_id')) {
  db.exec(`ALTER TABLE orders ADD COLUMN employer_id INTEGER REFERENCES users(id)`);
}

// ------------------------------------------------------------
// MIGRATION: conversation_reads — har bir foydalanuvchi suhbatni
// qachon oxirgi marta o'qiganini saqlaydi (unreadCount uchun).
// ------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, user_id)
);
`);

// Bir martalik kod: Telegram Mini App → brauzer (web) sessiya ko'chirish
db.exec(`
CREATE TABLE IF NOT EXISTS transfer_codes (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
`);

module.exports = db;
