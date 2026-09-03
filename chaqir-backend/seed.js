// ============================================================
// SEED — faqat reference ma'lumot: viloyat / tuman / mahalla / skill
// Demo ishchilar, buyurtma, suhbat YUKLANMAYDI.
// Ishlatish: `node seed.js`  (yoki `npm run seed`)
// ============================================================

const db = require('./db');
const mock = require('./mock-export.json');

const alreadySeeded = db.prepare('SELECT COUNT(*) AS c FROM regions').get().c > 0;
if (alreadySeeded) {
  console.log('[seed] Regions allaqachon bor — reference seed tashlandi.');
  console.log('[seed] Demo ishchilarni olib tashlash: npm run clear-demo');
  process.exit(0);
}

const insertRegion = db.prepare('INSERT INTO regions (name) VALUES (?)');
const insertDistrict = db.prepare('INSERT INTO districts (name, region_id) VALUES (?, ?)');
const insertMahalla = db.prepare('INSERT INTO mahallas (name, district_id) VALUES (?, ?)');
const insertSkill = db.prepare('INSERT INTO skills (id, label, icon) VALUES (?, ?, ?)');

const seedAll = db.transaction(() => {
  const regionIdByName = {};
  for (const regionName of mock.MOCK_REGIONS) {
    const { lastInsertRowid } = insertRegion.run(regionName);
    regionIdByName[regionName] = lastInsertRowid;
  }

  const districtIdByName = {};
  for (const [regionName, districts] of Object.entries(mock.MOCK_DISTRICTS)) {
    for (const districtName of districts) {
      const { lastInsertRowid } = insertDistrict.run(districtName, regionIdByName[regionName]);
      districtIdByName[districtName] = lastInsertRowid;
    }
  }

  for (const [districtName, mahallas] of Object.entries(mock.MOCK_MAHALLAS)) {
    const districtId = districtIdByName[districtName];
    if (!districtId) continue;
    for (const mahallaName of mahallas) {
      insertMahalla.run(mahallaName, districtId);
    }
  }

  for (const skill of mock.MOCK_SKILLS) {
    insertSkill.run(skill.id, skill.label, skill.icon);
  }
});

seedAll();
console.log('[seed] Tayyor: regions / districts / mahallas / skills.');
console.log('[seed] Demo ishchilar YO\'Q — tavsiya ro\'yxati haqiqiy ro\'yxatdan o\'tganlardan to\'ldiriladi.');
