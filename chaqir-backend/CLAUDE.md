# CLAUDE.md — CHAQIR backend uchun qattiq ko'rsatmalar

Bu loyiha ustida ishlayotgan har qanday Claude sessiyasi (chat, Claude Code,
yoki boshqa) quyidagi qoidalarga **so'zsiz** amal qiladi.

## 1. `.env` faylini hech qachon ochma

- `.env` faylini **hech qachon** `view`, `cat`, `bash_tool` yoki boshqa
  vosita bilan o'qima — hatto "tekshirib ko'raman", "debug qilaman",
  "to'g'ri sozlanganini tasdiqlayman" kabi sabab bilan ham.
- `.env` ichida `TELEGRAM_BOT_TOKEN` kabi maxfiy qiymatlar bor. Ularni
  o'qish, chop etish, log qilish, yoki javobga (chat matniga, faylga,
  zip'ga) qo'shish **taqiqlanadi**.
- Loyihani zip qilib foydalanuvchiga taqdim etayotganda `.env` fayli
  **har doim** chiqarib tashlanishi kerak (`zip -x ".env"`). Buni har
  safar tekshir — bitta marta qo'shilgan `-x` qoidasi keyingi safar
  unutilishi mumkin, shuning uchun har bir zip buyrug'idan oldin buni
  qayta tasdiqla.
- Agar sozlash uchun `.env`ga nima yozish kerakligini tushuntirish kerak
  bo'lsa — buni **README.md orqali** tushuntir (masalan qaysi kalitlar
  kerak), lekin foydalanuvchining haqiqiy `.env` faylining mazmunini
  hech qachon o'qib chiqma yoki takrorlama.
- Bu qoida `data/*.db*`, `node_modules/`, va boshqa maxfiy/generatsiya
  qilingan fayllar uchun ham amal qiladi — ular ham har doim zip'dan
  chiqarib tashlanadi.

## 2. Foydasiz ish qilma

- Har bir o'zgarish real muammoni hal qilishi yoki aniq so'ralgan narsani
  bajarishi kerak. "Balki kerak bo'lar" degan asosda kod yozma,
  refaktor qilma, yangi fayl yaratma.
- Agar biror narsa foydalanuvchiga hech qanday amaliy foyda keltirmasa
  (masalan ortiqcha abstraktsiya, ishlatilmaydigan endpoint, keraksiz
  hujjat, dublikat tushuntirish) — uni qilma va taklif ham qilma.
- Har bir javobda: avval nima qilinishi kerakligini aniq belgila, keyin
  faqat o'shani bajar. Ortiqcha "bonus" o'zgarishlar qo'shma.
- Kod yozgach — har doim ishga tushirib sinab ko'r (curl/test bilan).
  Sinovsiz "tayyor" deb topshirma.
- ROADMAP.md dagi bosqichlarga rioya qil: navbatdagi eng mantiqiy
  bosqichni tanla, uni to'liq bajar, keyin ROADMAP.md va README.md ni
  yangilab qo'y — shunda keyingi sessiya qayerdan davom etishni biladi.

## 3. Umumiy tartib

- `data/chaqir.db*` — test paytida yaratilgan bo'lsa, ishni tugatgach
  tozalab qo'y (foydalanuvchiga bo'sh/production holatidagi loyiha
  yetib borishi kerak, sinov ma'lumotlari bilan emas).
- Har bir zip yaratishdan oldin: `.env`, `node_modules/`, `data/chaqir.db*`
  chiqarib tashlanganini tekshir.
