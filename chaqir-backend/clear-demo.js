// Demo / test foydalanuvchilarni o'chirish (geo + skills qoladi)
const db = require('./db');

const tables = [
  'messages',
  'conversation_reads',
  'conversations',
  'orders',
  'reviews',
  'portfolio_items',
  'worker_skills',
  'employer_favorites',
  'sessions',
  'transfer_codes',
  'users'
];

const run = db.transaction(() => {
  for (const t of tables) {
    try {
      const r = db.prepare(`DELETE FROM ${t}`).run();
      console.log(`[clear-demo] ${t}: ${r.changes} qator`);
    } catch (e) {
      console.warn(`[clear-demo] ${t}:`, e.message);
    }
  }
});

run();
console.log('[clear-demo] Foydalanuvchilar va bog\'liq ma\'lumotlar o\'chirildi. Geo/skills saqlanadi.');
