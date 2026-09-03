# CHAQIR — Backend (API-only)

Bu papkada faqat backend (Express + SQLite) bor. Frontend ALOHIDA repo/hostingda
turadi va shu backend'ga API orqali (masalan ngrok domeni orqali) ulanadi.

## Tuzilma

```
chaqir-backend/
  server.js        ← Express server (faqat /api/* endpoint'lar)
  db.js             ← SQLite schema (birinchi ishga tushganda avtomatik yaratiladi)
  seed.js           ← Demo ma'lumotlarni (mock-export.json) bazaga bir martalik yuklaydi
  mock-export.json  ← viloyat/skill/8 ta demo ishchi ma'lumotlari
  package.json
  .env              ← PORT va ALLOWED_ORIGIN shu yerda
  data/             ← SQLite fayli shu yerda yaratiladi (chaqir.db) — git'ga tushmaydi
```

## Ishga tushirish

```bash
cd chaqir-backend
npm install          # express, cors, dotenv, better-sqlite3 o'rnatiladi
npm run seed          # demo ma'lumotlarni (viloyatlar, skill'lar, 8 ta ishchi) bazaga yozadi
npm start             # yoki: node server.js
```

Server `http://localhost:3000` da ishga tushadi va faqat `/api/*` endpoint'larni beradi
(masalan `GET http://localhost:3000/api/health`).

`npm run seed` faqat **bir marta** kerak (agar `regions` jadvali bo'sh bo'lmasa, seed.js
o'zi hech narsa qilmay chiqib ketadi — xavfsiz, qayta-qayta ishga tushirsangiz ham
dublikat bo'lmaydi). Bazani noldan boshlash uchun `data/chaqir.db*` fayllarini o'chirib,
`npm run seed` ni qayta ishga tushiring.

## Frontend (alohida joyda) bilan ulash

Frontend qayerda bo'lishidan qat'i nazar (GitHub Pages, boshqa hosting, yoki lokal
boshqa portda), u shu backend'ga API bazaviy URL orqali murojaat qiladi.

`.env` faylida:
```
PORT=3000
ALLOWED_ORIGIN=https://your-frontend-domain.example
```

`ALLOWED_ORIGIN` — frontend qaysi domendan so'rov yuborsa, shu domenga ruxsat beradi
(CORS). Bir nechta domenga ruxsat kerak bo'lsa yoki hali frontend domeni aniq bo'lmasa,
vaqtincha `ALLOWED_ORIGIN=*` qo'yish mumkin (faqat local test uchun xavfsiz,
productionda albatta aniq domenni yozing).

## Ngrok bilan tashqariga ochish

```bash
node server.js
ngrok http --url=satisfy-endurance-mooned.ngrok-free.dev 3000
```

Frontend shu ngrok domenini API bazaviy URL sifatida ishlatadi (masalan
`js/api.js` ichidagi `BASE_URL`).

## Autentifikatsiya

Endi backend'da session-token asosidagi haqiqiy autentifikatsiya bor:

- `POST /api/auth/telegram` — body: `{ initData }` (Telegram Mini App'dan xom
  string). Backend `TELEGRAM_BOT_TOKEN` bilan HMAC-SHA256 orqali tekshiradi,
  `telegram_id` bo'yicha userni topib session token qaytaradi. Foydalanish
  uchun `.env`ga `TELEGRAM_BOT_TOKEN=...` yozing.
- `POST /api/auth/login` — body: `{ phone, password }` (brauzer-demo fallback).
- `GET /api/auth/me` — joriy tokenga tegishli foydalanuvchini qaytaradi
  (`Authorization: Bearer <token>` header bilan).
- `POST /api/auth/logout` — sessionni o'chiradi.
- `POST /api/workers` va `POST /api/employers` endi ixtiyoriy `password` (va
  `telegram_id`) qabul qiladi, javobda darhol `token` qaytaradi (ro'yxatdan
  o'tgach avtomatik "kirgan" bo'lish uchun).

Himoyalangan endpointlar (`Authorization: Bearer <token>` talab qiladi, va
so'ralayotgan `id` token egasiga mos kelishini tekshiradi):
`/api/employers/:employerId/favorites*`, `GET /api/orders`,
`POST /api/orders`, `PATCH /api/orders/:id/status`, `GET /api/conversations`,
`POST /api/conversations`, `POST /api/conversations/:id/messages`.

`GET /api/orders` endi ikki xil so'rovni qo'llab-quvvatlaydi:
- `?worker_id=<id>` — shu workerga kelgan buyurtmalar (avvalgidek)
- `?employer_id=<id>` — shu employer yuborgan so'rovlar, worker nomi va
  holati (`status`) bilan birga (worker o'z buyurtmasini "bajarildi" qilib
  belgilaganda employer ham shu orqali ko'ra oladi)

## Diqqat

- `ALLOWED_ORIGIN=*` bilan ishlatish faqat local test uchun xavfsiz.
- Qolgan frontend integratsiyasi (`api.js`ga token qo'shish, `boot()`da
  `auth/me` chaqirish va h.k.) uchun `ROADMAP.md`ning 1.3-bo'limiga qarang.
