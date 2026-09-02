/* ============================================================
   DATA LOADER
   Ilgari bu faylda qo'lda yozilgan MOCK_* massivlar bor edi.
   Endi bular BACKEND'dan (ChaqirAPI orqali) yuklanadi — lekin
   app.js kodi o'zgarmasligi uchun ATAYLAB xuddi shu nomlar
   (MOCK_REGIONS, MOCK_SKILLS, MOCK_WORKERS va h.k.) saqlab
   qolingan va `let` bilan e'lon qilingan (const emas), chunki
   endi ular runtime'da to'ldiriladi.

   `loadInitialData()` — ilova ishga tushishidan OLDIN chaqiriladi
   (app.js oxiridagi INIT blokida `await` qilinadi). Shu funksiya
   tugagach MOCK_REGIONS/MOCK_SKILLS/MOCK_WORKERS haqiqiy backend
   ma'lumotlari bilan to'ladi.

   MOCK_DISTRICTS / MOCK_MAHALLAS — endi oldindan to'liq
   yuklanmaydi (backend'da ko'p bo'lishi mumkin), ular kerak
   bo'lganda (hudud tanlash sheet ochilganda) "on-demand" backend'dan
   olinib, shu obyektlarga keshlanadi — app.js'dagi
   `MOCK_DISTRICTS[state.region]` kabi murojaatlar ishlab turishi
   uchun forma bir xil saqlangan.
============================================================ */

let MOCK_REGIONS = [];
let MOCK_DISTRICTS = {};   // kesh: { [regionName]: [districtName, ...] }
let MOCK_MAHALLAS = {};    // kesh: { [districtName]: [mahallaName, ...] }
let MOCK_SKILLS = [];
let MOCK_WORKERS = [];
let MOCK_ORDERS = [];        // login/ro'yxatdan o'tgandan keyin worker uchun yuklanadi
let MOCK_CONVERSATIONS = []; // login/ro'yxatdan o'tgandan keyin yuklanadi

// Hudud/tuman/mahalla — sheet ochilganda backend'dan olib, keshga
// yozib qo'yamiz (bir marta so'ralgan viloyat/tuman uchun ikkinchi
// marta tarmoqqa chiqilmaydi).
async function ensureDistrictsLoaded(region) {
  if (MOCK_DISTRICTS[region]) return MOCK_DISTRICTS[region];
  try {
    const list = await ChaqirAPI.getDistricts(region);
    MOCK_DISTRICTS[region] = list;
    return list;
  } catch (e) {
    console.error('Tumanlarni yuklashda xatolik:', e);
    return [];
  }
}

async function ensureMahallasLoaded(district) {
  if (MOCK_MAHALLAS[district]) return MOCK_MAHALLAS[district];
  try {
    const list = await ChaqirAPI.getMahallas(district);
    MOCK_MAHALLAS[district] = list;
    return list;
  } catch (e) {
    console.error('Mahallalarni yuklashda xatolik:', e);
    return [];
  }
}

// Ilova ishga tushishidan oldin — viloyatlar, ko'nikmalar va
// (home feed + qidiruv uchun) barcha ishchilar ro'yxati yuklanadi.
async function loadInitialData() {
  try {
    const [regions, skills, workers] = await Promise.all([
      ChaqirAPI.getRegions(),
      ChaqirAPI.getSkills(),
      ChaqirAPI.getWorkers()
    ]);
    MOCK_REGIONS = regions;
    MOCK_SKILLS = skills;
    MOCK_WORKERS = workers;
  } catch (e) {
    console.error('Boshlang\'ich ma\'lumotlarni yuklashda xatolik (backend ishlayaptimi?):', e);
  }
}

// Worker ro'yxatdan o'tgandan/kirgandan keyin — uning buyurtmalarini
// backend'dan yangilaydi (renderWorkerOrders shu massivni o'qiydi).
async function refreshWorkerOrders() {
  if (!appState.id) { MOCK_ORDERS = []; return; }
  try {
    MOCK_ORDERS = await ChaqirAPI.getOrders(appState.id);
  } catch (e) {
    console.error('Buyurtmalarni yuklashda xatolik:', e);
    MOCK_ORDERS = [];
  }
}

// Har ikkala rol uchun ham — suhbatlar ro'yxatini backend'dan yangilaydi.
// Backend `created_at` ni "YYYY-MM-DD HH:MM:SS" (SQLite datetime())
// formatida qaytaradi — chat oynasida bu "HH:MM" ko'rinishiga
// qisqartiriladi (mavjud demo formatiga mos).
function formatMsgTime(raw) {
  if (!raw) return '';
  const match = /(\d{2}):(\d{2})/.exec(raw);
  return match ? `${match[1]}:${match[2]}` : raw;
}

async function refreshConversations() {
  if (!appState.id) { MOCK_CONVERSATIONS = []; return; }
  try {
    const convs = await ChaqirAPI.getConversations(appState.id);
    MOCK_CONVERSATIONS = convs.map(c => ({
      ...c,
      messages: c.messages.map(m => ({ ...m, time: formatMsgTime(m.time) }))
    }));
  } catch (e) {
    console.error('Suhbatlarni yuklashda xatolik:', e);
    MOCK_CONVERSATIONS = [];
  }
}
