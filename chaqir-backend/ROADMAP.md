# CHAQIR — Qolgan backend integratsiyasi bo'yicha ROADMAP

Bu fayl hozircha **qilinmagan** (yoki qisman/vaqtinchalik qilingan) 3 ta ishni
to'liq amalga oshirish uchun bosqichma-bosqich reja beradi:

1. ✅ Haqiqiy autentifikatsiya (login/session) — **backend + frontend asosiy oqim tayyor**
2. ✅ Yangi suhbat (chat) boshlash — **backend + frontend tayyor**
3. ✅ Employer'dan workerga buyurtma yuborish — **backend + frontend (UI/forma) tayyor**

Har bir bo'lim uchun: **nima yetishmayapti → nima qo'shish kerak (DB / backend /
frontend) → qabul qilish mezonlari (test qilib ko'rish uchun)**.

---

## 1. Haqiqiy autentifikatsiya (login/session)

### Hozirgi holat
- Backend session-token, Telegram HMAC, password login, requireAuth — tayyor.
- Frontend: token localStorage, Authorization header, restoreSession, logout — tayyor.
- Brauzer-demo hali `GET /api/users/by-phone` orqali kiradi (token bermaydi) —
  to'liq himoya uchun register yoki Telegram/password login kerak.

### 1.1 — DB o'zgarishlari (`db.js`) ✅ BAJARILDI
- [x] `users` jadvaliga qo'shish:
  - `password_hash TEXT`
  - `telegram_id` to'ldiriladi
- [x] Yangi jadval `sessions`

### 1.2 — Backend (`server.js`) ✅ BAJARILDI
- [x] Session-token, Telegram auth, password login, requireAuth, logout, auth/me

### 1.3 — Frontend (`js/api.js`, `app.js`) ✅ BAJARILDI
- [x] `api.js`: har bir so'rovga `Authorization: Bearer <token>` header
- [x] `finishRegistration()`: backend javobidagi `token`ni saqlash
- [x] `boot()` / `restoreSession()`: token bo'lsa `GET /api/auth/me` → to'g'ridan-to'g'ri home
- [x] `loginShare()`: avval `POST /api/auth/telegram` (Telegram ichida), fallback telefon
- [x] Profil ekranida "Chiqish" → `POST /api/auth/logout` + token tozalash

### Qabul qilish mezonlari
- [x] Ro'yxatdan o'tgan foydalanuvchi F5 qilsa — home ochiladi (token orqali)
- [x] Token eskirgan bo'lsa — 401, frontend tokenni tozalaydi
- [x] Himoyalangan endpointlar faqat token egasiga ishlaydi

---

## 2. Yangi suhbat (chat) boshlash

### 2.1 — Backend ✅ BAJARILDI
- [x] `POST /api/conversations` — `user_a_id` token'dan, body'da faqat `user_b_id`

### 2.2 — Frontend (`js/api.js`) ✅ BAJARILDI
- [x] `createConversation(userBId)` — faqat `user_b_id` yuboradi

### 2.3 — Frontend (`js/app.js`) ✅ BAJARILDI
- [x] `messageWorker(worker)` — suhbat ochadi / mavjudini qaytaradi, chat-detail'ga o'tadi

### Qabul qilish mezonlari
- [x] Birinchi "Xabar yozish" — bo'sh chat ochiladi
- [x] Ikkinchi marta — eski suhbat ochiladi (yangi yaratilmaydi)

---

## 3. Employer'dan workerga buyurtma yuborish

### 3.1 — Backend ✅ BAJARILDI
- [x] `POST /api/orders` — body: `{ worker_id, skill, mahalla }`, client_name token'dan
- [x] `employer_id` ustuni, `GET /api/orders?employer_id=...`

### 3.2 — Frontend (`js/api.js`) ✅
- [x] `createOrder(data)` mavjud

### 3.3 — Frontend (`js/app.js` + `index.html`) ✅ BAJARILDI
- [x] Worker-detail: **"So'rov yuborish"** tugmasi (faqat employer)
- [x] Bottom-sheet: ko'nikma tanlash + mahalla + yuborish
- [x] `openOrderSheet` / `closeOrderSheet` / `submitOrderRequest`
- [x] Worker buyurtmalarida "Bajarildi" / "Bekor qilish" tugmalari

### Qabul qilish mezonlari
- [x] Employer so'rov yuborsa — worker "Buyurtmalar" tabida ko'rinadi
- [x] Worker statusni o'zgartirsa — backendda saqlanadi

---

## 4. Brauzer-demo parol login + unread ✅ BAJARILDI

- [x] Login forma: telefon + parol → `POST /api/auth/login` (token beradi)
- [x] Ro'yxatdan o'tishda ixtiyoriy parol maydoni
- [x] Seed: barcha demo workerlar paroli `demo1234`
- [x] `conversation_reads` jadvali + `POST /api/conversations/:id/read`
- [x] `GET /api/conversations` real `unreadCount` qaytaradi
- [x] `sendMessage` API faqat `text` yuboradi (sender_id token'dan)

---

## Keyingi mumkin bo'lgan ishlar (ixtiyoriy)

- Real-time chat (polling yoki WebSocket)
- Portfolio rasmlarini backend orqali yuklash / tahrirlash
- Profilni tahrirlash (`editProfile` hozir toast)
- Employer o'z yuborgan so'rovlarini alohida tabda ko'rish

## 5. Demo qoldiqlarini olib tashlash ✅ BAJARILDI

- [x] Qo'ng'iroq — `tel:` haqiqiy qo'ng'iroq
- [x] Profil tahrirlash — `PATCH /api/me` + UI sheet
- [x] Portfolio qo'shish — `POST /api/workers/:id/portfolio` (URL)
- [x] Sharh yozish — `POST /api/workers/:id/reviews`
- [x] Chat polling — har 3 soniyada yangilanadi
- [x] Profil statistikasi — haqiqiy rating / reviewCount
