/* ============================================================
   CHAQIR — App logic (SPA navigation + state)
   Bu fayl umuman fetch()/API chaqirmaydi. Hamma narsa `appState`
   va MOCK_* massivlar ustida ishlaydi. Kelajakda backend ulanganda
   faqat MOCK_* o'rniga API javoblari, appState.* saqlash o'rniga
   POST so'rovlar qo'yiladi — screen strukturasi o'zgarmaydi.
============================================================ */

// ------------------------------------------------------------
// GLOBAL STATE
// Foydalanuvchi tanlagan HAR BIR narsa shu yerga yoziladi.
// Har bir ekran shu obyektni o'qiydi va yozadi — ekranlar
// orasida ma'lumot uzatishning yagona manbasi shu.
// ------------------------------------------------------------
let appState = {
  id: null,           // backend'dagi users.id — ro'yxatdan o'tgach/kirgach to'ladi
  token: null,        // session token — localStorage'da ham saqlanadi (F5'dan keyin ham kirgan holatda qolish uchun)
  role: null,        // 'worker' | 'employer'
  name: '',
  skills: [],         // faqat worker uchun
  region: null,
  district: null,
  mahalla: null,
  address: '',
  phone: null,
  favorites: []       // faqat employer uchun — saqlangan ishchilarning id'lari
};

// Qidiruv filtri uchun alohida state (appState'ga aralashtirilmaydi,
// chunki bu ro'yxatdan o'tish emas, employer'ning vaqtinchalik so'rovi)
let searchFilterState = {
  skills: [],
  region: null,
  district: null
};

// ------------------------------------------------------------
// NAVIGATSIYA STACK
// MANTIQ: bu oddiy massiv, har safar go() chaqirilganda hozirgi
// ekran shu massivga "push" qilinadi. goBack() bosilganda esa
// massivning oxirgisi "pop" qilinib o'sha ekranga qaytiladi.
//
// Nega browser back emas? Chunki bu SPA — sahifa reload bo'lmaydi,
// demak browser history ham yo'q. Bizga o'zimizning "xotira"miz kerak.
//
// Vizual model: bu — bir uyum qog'oz (stack of papers). Har yangi
// ekranga o'tganda eski ekran shu uyumga tashlanadi. Orqaga
// qaytish deganda — eng ustidagi qog'ozni olib, o'sha ekranni
// ko'rsatasan.
// ------------------------------------------------------------
let screenHistory = [];
let currentScreen = 'onboarding';

// ------------------------------------------------------------
// HAPTIC FEEDBACK (3.6 roadmap punkti)
// MANTIQ: bu — Telegram Mini App, demak native
// `Telegram.WebApp.HapticFeedback` API'si mavjud (`impactOccurred`,
// `notificationOccurred`, `selectionChanged`). Backend yo'q, lekin
// bu API hardware/backend emas — Telegram klientining o'zi
// taqdim etadi, shuning uchun hozir ham real ulash mumkin va kerak.
// Demo-brauzerda (Telegram tashqarisida) `window.Telegram` obyekti
// yo'q — shuning uchun har chaqiriqda try/catch bilan xavfsiz
// no-op qilinadi, ilova sinmaydi.
//
// XARITALASH QOIDASI (qaysi turdagi harakatga qaysi haptic mos):
//   haptic.light()     — kichik, tez-tez bosiladigan narsalar:
//                         tab almashish, orqaga qaytish, icon-btn,
//                         favorite/heart bosish, chip toggle
//   haptic.medium()     — "muhim qadam" tugmalari: onboarding/forma
//                         CTA (Davom etish), rol tanlash, tasdiqlash
//   haptic.selection()  — bir nechta variant orasidan tanlash:
//                         bottom-sheet item, sort variant tanlash
//                         (bular pastda "selectionChanged" chaqiradi,
//                         bu Telegram/iOS'da picker-tanlash hissi)
//   haptic.success()    — muvaffaqiyatli yakun: ro'yxatdan o'tish
//                         tugadi (success ekrani)
//   haptic.error()      — forma validatsiya xatosi (shake bilan bir vaqtda)
// ------------------------------------------------------------
const haptic = {
  light()  { try { Telegram.WebApp.HapticFeedback.impactOccurred('light'); } catch (e) {} },
  medium() { try { Telegram.WebApp.HapticFeedback.impactOccurred('medium'); } catch (e) {} },
  selection() { try { Telegram.WebApp.HapticFeedback.selectionChanged(); } catch (e) {} },
  success() { try { Telegram.WebApp.HapticFeedback.notificationOccurred('success'); } catch (e) {} },
  error()  { try { Telegram.WebApp.HapticFeedback.notificationOccurred('error'); } catch (e) {} }
};

// ------------------------------------------------------------
// TELEGRAM MINI APP BOOT
// ------------------------------------------------------------
function getTg() {
  try {
    return (window.Telegram && Telegram.WebApp) ? Telegram.WebApp : null;
  } catch (e) {
    return null;
  }
}

function isTelegramMiniApp() {
  const tg = getTg();
  // initData bo'sh string brauzerda ham bo'lishi mumkin; platform
  // yoki class bilan ishonchliroq aniqlaymiz.
  return !!(tg && (tg.initData || tg.initDataUnsafe?.user || document.documentElement.classList.contains('tg-mini-app')));
}

function initTelegramMiniApp() {
  const tg = getTg();
  if (!tg) return;

  try {
    document.documentElement.classList.add('tg-mini-app');
    tg.ready();
    tg.expand();
    // Header / background ranglari — ilova tokenlariga mos
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#FAFAFA';
    const header = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() || bg;
    try { tg.setHeaderColor(header.startsWith('#') ? header : 'secondary_bg_color'); } catch (e) {}
    try { tg.setBackgroundColor(bg.startsWith('#') ? bg : 'bg_color'); } catch (e) {}
    try { tg.enableClosingConfirmation(); } catch (e) {}

    // Native orqaga tugmasi
    if (tg.BackButton) {
      tg.BackButton.onClick(() => goBack());
    }

    // Tema o'zgarsa (Telegram sozlamasi)
    tg.onEvent && tg.onEvent('themeChanged', () => {
      try {
        const saved = localStorage.getItem('chaqir-theme');
        if (saved === 'dark' || saved === 'light') return; // foydalanuvchi tanlovi ustun
        document.documentElement.setAttribute('data-theme', tg.colorScheme === 'dark' ? 'dark' : 'light');
      } catch (e) {}
    });
  } catch (e) {
    console.warn('Telegram WebApp init:', e);
  }
}

function syncTelegramBackButton() {
  const tg = getTg();
  if (!tg || !tg.BackButton) return;
  try {
    if (screenHistory.length > 0) tg.BackButton.show();
    else tg.BackButton.hide();
  } catch (e) {}
}

function go(screenId) {
  // Hozirgi ekranni stack'ga push qilamiz — keyin orqaga qaytish uchun
  screenHistory.push(currentScreen);
  renderScreen(screenId, 'forward');
}

function goBack() {
  haptic.light(); // 3.6: orqaga qaytish — kichik harakat
  if (screenHistory.length === 0) {
    // Stack bo'sh — Telegramda Mini App ni yopish mumkin
    const tg = getTg();
    if (tg && isTelegramMiniApp()) {
      try { tg.close(); } catch (e) {}
      return;
    }
    renderScreen('onboarding', 'back');
    return;
  }
  const prevScreen = screenHistory.pop();
  renderScreen(prevScreen, 'back');
}

// ------------------------------------------------------------
// BOTTOM TAB BAR — ROLGA QARAB BUTUNLAY BOSHQA TO'PLAM
// MANTIQ: Ishchi va Ish beruvchi endi bir xil 5 ta tabni ko'rmaydi.
// Ular ikkita mutlaqo boshqa auditoriya: ishchi ish QIDIRMAYDI (u
// ishni TOPILADI, ya'ni unga kelgan so'rovlarni ko'radi), employer
// esa ishchini o'zi QIDIRADI. Shuning uchun tab-set funksional
// jihatdan ham farqlanadi, shunchaki nom emas:
//
//   ISHCHI (4 tab):  Bosh sahifa | Buyurtmalar | Xabarlar | Profil
//   EMPLOYER (5 tab): Bosh sahifa | Qidiruv | Saqlangan | Xabarlar | Profil
//
// Har biri {tab, screen, icon, label} obyekti — icon shu yerda,
// chunki endi tab-bar HTML fayldan emas, shu konfiguratsiyadan
// generatsiya qilinadi (Bo'lim 1.4: dublikat HTML yo'qoladi, 5 ta
// joyda bir xil SVG qo'lda yozish o'rniga bitta manba).
// ------------------------------------------------------------
const ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';
const ICON_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
const ICON_MESSAGES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const ICON_PROFILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
// Buyurtmalar uchun yangi ikonka — worker uchun xos, boshqa hech
// bir joyda ishlatilmagan (roadmap 1.3: "har bir narsa uchun
// tanib bo'ladigan, alohida ikonka")
const ICON_ORDERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
// 2.14 — Saqlangandan "olib tashlash" tugmasi uchun. Yangi, boshqa
// hech qayerda ishlatilmagan (roadmap 1.3 bilan bir xil qoida).
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

const WORKER_TABS = [
  { tab: 'home',      screen: 'home',          icon: ICON_HOME,     label: 'Bosh sahifa' },
  { tab: 'orders',    screen: 'worker-orders', icon: ICON_ORDERS,   label: 'Buyurtmalar' },
  { tab: 'messages',  screen: 'messages',      icon: ICON_MESSAGES, label: 'Xabarlar' },
  { tab: 'profile',   screen: 'profile',       icon: ICON_PROFILE,  label: 'Profil' }
];

const EMPLOYER_TABS = [
  { tab: 'home',      screen: 'home',           icon: ICON_HOME,     label: 'Bosh sahifa' },
  { tab: 'search',    screen: 'search-filters',  icon: ICON_SEARCH,   label: 'Qidiruv' },
  { tab: 'favorites', screen: 'favorites',       icon: ICON_HEART,    label: 'Saqlangan' },
  { tab: 'messages',  screen: 'messages',        icon: ICON_MESSAGES, label: 'Xabarlar' },
  { tab: 'profile',   screen: 'profile',         icon: ICON_PROFILE,  label: 'Profil' }
];

// MANTIQ: agar appState.role hali belgilanmagan bo'lsa (nazariy
// jihatdan bo'lmasligi kerak, chunki tab-bar faqat ro'yxatdan
// o'tgandan keyin ko'rinadi) — employer to'plamiga tushadi, bu
// xavfsizroq default, chunki 5 ta tab 4 tadan ko'proq imkoniyat beradi.
function getActiveTabConfig() {
  return appState.role === 'worker' ? WORKER_TABS : EMPLOYER_TABS;
}

function getTabScreenMap() {
  const map = {};
  getActiveTabConfig().forEach(t => { map[t.tab] = t.screen; });
  return map;
}

// Tab-bar'ni HOZIRGI aktiv .screen ichidagi bo'sh
// <div class="tab-bar"></div> konteyneriga chizadi. Har ekranda
// bittadan shunday bo'sh konteyner bor (index.html'da statik HTML
// endi yo'q — hammasi shu funksiyadan chiqadi).
function renderTabBar(activeScreenId) {
  const container = document.querySelector('.screen.active .tab-bar');
  if (!container) return; // bu ekranda tab-bar umuman yo'q (masalan onboarding)

  const tabs = getActiveTabConfig();
  // A11y: pastki navigatsiya — bu "tablist" pattern. Screen-reader user uchun
  // faqat matn yetmaydi: "qaysi tab hozir tanlangan" degan holatni aria-selected
  // aytib turishi kerak, aks holda ko'r foydalanuvchi qaysi ekranda ekanini
  // faqat taxmin qiladi.
  container.setAttribute('role', 'tablist');
  container.innerHTML = tabs.map(t => {
    const isActive = t.screen === activeScreenId;
    return `
    <div class="tab-item${isActive ? ' active' : ''}" data-tab="${t.tab}" role="tab" tabindex="0" aria-selected="${isActive}" aria-label="${t.label}" onclick="switchTab('${t.tab}')" onkeydown="handleCardKeydown(event)">
      ${t.icon}
      <span>${t.label}</span>
    </div>
  `;
  }).join('');
}

function renderScreen(screenId, direction) {
  // MANTIQ (3.1 roadmap punkti): oldin hammasi bitta "screen-in"
  // animatsiyaga ega edi — forward (go), back (goBack) va tab
  // almashish (switchTab) farqlanmasdi. Endi yo'nalish CSS class
  // orqali beriladi:
  //   forward — go() chaqirganda: yangi ekran o'ngdan kirib keladi
  //             (hierarchiyada "ichkariga kirish" hissi)
  //   back    — goBack() chaqirganda: yangi (aslida oldingi) ekran
  //             chapdan kirib keladi ("orqaga chiqish" hissi,
  //             forward'ning aynan aksi)
  //   fade    — switchTab() chaqirganda: tab'lar bir xil
  //             ierarxiya darajasida (lateral), shuning uchun
  //             chapga/o'ngga surilish emas, oddiy fade to'g'ri —
  //             "Xabarlar"dan "Profil"ga o'tish "chuqurlashish"
  //             emas, joyni almashtirish
  const dir = direction || 'forward';
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active', 'dir-forward', 'dir-back', 'dir-fade'));
  const target = document.querySelector(`[data-screen="${screenId}"]`);
  if (target) target.classList.add('active', `dir-${dir}`);
  currentScreen = screenId;
  window.scrollTo(0, 0);

  // Har bir ekran ko'rsatilishidan oldin, o'sha ekranga xos
  // "refresh" funksiyasi bor bo'lsa — chaqiramiz (masalan step
  // indicator sonini qayta hisoblash, chip'larni qayta chizish).
  if (screenId === 'skills-select') renderSkillChips();
  if (screenId === 'name-input' || screenId === 'skills-select' || screenId === 'region-select' || screenId === 'phone-share') {
    updateProgressSteps();
  }
  if (screenId === 'home') renderHome();
  if (screenId === 'search-filters') renderFilterChips();
  if (screenId === 'profile') renderProfile();
  if (screenId === 'worker-orders') renderWorkerOrders();
  if (screenId === 'favorites') renderFavorites();
  if (screenId === 'messages') renderMessages();
  if (screenId === 'chat-detail') renderChat();
  if (screenId === 'success') { fireConfetti(); haptic.success(); } // 3.6: muvaffaqiyatli yakun

  syncTelegramBackButton();

  // MANTIQ: tab-bar endi rolga qarab BUTUNLAY BOSHQA to'plam bilan
  // chiziladi — shuning uchun oddiy CSS class toggle yetarli emas,
  // har safar to'liq qayta generatsiya qilinadi (renderTabBar).
  renderTabBar(screenId);
}

function cancelFlow() {
  // To'liq reset — ro'yxatdan o'tish jarayonidan chiqib ketish
  appState = { id: null, token: null, role: null, name: '', skills: [], region: null, district: null, mahalla: null, address: '', phone: null, favorites: [] };
  screenHistory = [];
  searchAttemptCount = 0; // demo error-simulyatsiya hisoblagichi ham tozalanadi
  renderScreen('onboarding', 'back'); // flow'dan chiqish

}

// ------------------------------------------------------------
// STEP INDICATOR
// MANTIQ: Worker uchun 4 qadam (Ism -> Skill -> Hudud -> Telefon),
// Employer uchun 3 qadam (Ism -> Hudud -> Telefon, skill skip).
// Shuning uchun dot sonini appState.role'ga qarab DINAMIK chizamiz.
// ------------------------------------------------------------
const STEP_MAP = {
  'name-input': 1,
  'skills-select': 2,      // faqat worker
  'region-select-worker': 3,
  'region-select-employer': 2,
  'phone-share-worker': 4,
  'phone-share-employer': 3
};

function updateProgressSteps() {
  const totalSteps = appState.role === 'worker' ? 4 : 3;
  let activeStep;
  if (currentScreen === 'name-input') activeStep = 1;
  else if (currentScreen === 'skills-select') activeStep = 2;
  else if (currentScreen === 'region-select') activeStep = appState.role === 'worker' ? 3 : 2;
  else if (currentScreen === 'phone-share') activeStep = appState.role === 'worker' ? 4 : 3;

  const containerId = {
    'name-input': 'name-progress',
    'skills-select': 'skills-progress',
    'region-select': 'region-progress',
    'phone-share': 'phone-progress'
  }[currentScreen];

  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';
  const dots = [];
  for (let i = 1; i <= totalSteps; i++) {
    const dot = document.createElement('div');
    dot.className = 'progress-dot';
    // MUHIM: bu bosqichda .done/.active QO'SHILMAYDI — dot hali
    // "bo'sh yo'l" holatida yaratiladi. .progress-dot-fill width:0
    // bilan boshlanadi. Bir frame keyin (pastdagi rAF) holatlar
    // qo'yiladi — shu farq CSS transition'ni ishga tushiradi.
    const fill = document.createElement('div');
    fill.className = 'progress-dot-fill';
    dot.appendChild(fill);
    container.appendChild(dot);
    dots.push(dot);
  }
  requestAnimationFrame(() => {
    dots.forEach((dot, idx) => {
      const i = idx + 1;
      if (i < activeStep) dot.classList.add('done');
      if (i === activeStep) dot.classList.add('active');
    });
  });
}

// ------------------------------------------------------------
// 2. ROL TANLASH
// ------------------------------------------------------------
// A11y: universal keyboard handler — div-based "tugma"lar (role="radio"/"button"
// bo'lgan <div onclick>'lar) uchun Enter/Space bosilganda ham xuddi klik bo'lganday
// ishlashi kerak. Screen-reader va klaviatura foydalanuvchisi mushukdek "tap"
// qila olmaydi — shuning uchun bu yo'q bo'lsa, ular uchun element umuman ishlamaydi.
function handleCardKeydown(event, arg) {
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault(); // Space sahifani pastga scroll qilib yubormasin
    event.currentTarget.click();
  }
}

function selectRole(role) {
  haptic.medium(); // 3.6: muhim tanlov — flow'ning butun yo'nalishini belgilaydi
  appState.role = role;
  const cards = [
    document.getElementById('role-worker'),
    document.getElementById('role-employer')
  ];
  cards.forEach(card => {
    const isSel = card.id === (role === 'worker' ? 'role-worker' : 'role-employer');
    card.classList.toggle('selected', isSel);
    card.setAttribute('aria-checked', isSel ? 'true' : 'false');
    card.classList.remove('is-bouncing');
    if (isSel) {
      // force reflow so animation restarts on re-select
      void card.offsetWidth;
      card.classList.add('is-bouncing');
      card.addEventListener('animationend', () => {
        card.classList.remove('is-bouncing');
      }, { once: true });
    }
  });
  document.getElementById('role-next-btn').classList.remove('is-disabled');
}

function goNextAfterRole() {
  if (!appState.role) return;
  haptic.medium(); // 3.6: flow bosqichini tasdiqlash
  go('name-input');
}

// ------------------------------------------------------------
// 2.3 — Field helpers (error, counter, floating)
// ------------------------------------------------------------
function setFieldError(fieldId) {
  haptic.error(); // 3.6: forma validatsiya xatosi — shake bilan bir vaqtda
  const el = document.getElementById(fieldId);
  if (el) {
    el.classList.remove('has-error');
    void el.offsetWidth; // reflow — shake qayta ishlashi uchun
    el.classList.add('has-error');
  }
}
function clearFieldError(fieldId) {
  const el = document.getElementById(fieldId);
  if (el) el.classList.remove('has-error');
}
function updateCharCounter(inputId, counterId, max) {
  const input = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  if (!input || !counter) return;
  const len = input.value.length;
  counter.textContent = len + ' / ' + max;
  counter.classList.toggle('near', len >= max * 0.85 && len < max);
  counter.classList.toggle('full', len >= max);
}

// ------------------------------------------------------------
// 3. ISM
// ------------------------------------------------------------
function checkName() {
  const val = document.getElementById('name-field').value.trim();
  appState.name = val;
  document.getElementById('name-next-btn').classList.toggle('is-disabled', val.length === 0);
  clearFieldError('field-name');
  updateCharCounter('name-field', 'name-counter', 50);
}

function checkAddress() {
  clearFieldError('field-address');
  updateCharCounter('address-field', 'address-counter', 80);
}

function goNextAfterName() {
  const val = document.getElementById('name-field').value.trim();
  if (!val) {
    setFieldError('field-name');
    return;
  }
  appState.name = val;
  haptic.medium(); // 3.6: flow bosqichini tasdiqlash
  // MANTIQ: agar worker bo'lsa — skill tanlash kerak.
  // Employer bo'lsa — bu qadam butunlay SKIP qilinadi (brief talabi).
  if (appState.role === 'worker') {
    go('skills-select');
  } else {
    go('region-select');
  }
}

// ------------------------------------------------------------
// 4. SKILL TANLASH (faqat worker)
// ------------------------------------------------------------
const CHIP_CHECK_SVG = '<span class="chip-check" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>';

function renderSkillChips() {
  const container = document.getElementById('skills-chip-group');
  container.innerHTML = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Ko\'nikmalarni tanlang');
  MOCK_SKILLS.forEach(skill => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.skill = skill.id;
    chip.innerHTML = `${CHIP_CHECK_SVG}${skill.icon}<span>${skill.label}</span>`;
    const isSelected = appState.skills.includes(skill.id);
    if (isSelected) chip.classList.add('selected');
    // A11y: chip — checkbox pattern (bir nechtasi tanlanishi mumkin).
    chip.setAttribute('role', 'checkbox');
    chip.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    chip.tabIndex = 0;
    chip.onclick = () => toggleChip(chip, appState.skills, 'skills-next-btn');
    chip.onkeydown = (e) => handleCardKeydown(e);
    container.appendChild(chip);
  });
  updateSkillsCountBadge();
  // Fade-edge: overflow bormi?
  requestAnimationFrame(() => setupChipScrollFade('skills-chip-scroll'));
}

function updateSkillsCountBadge() {
  const badge = document.getElementById('skills-count-badge');
  if (!badge) return;
  const n = appState.skills.length;
  if (n > 0) {
    badge.textContent = String(n);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function setupChipScrollFade(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const check = () => {
    const hasOverflow = wrap.scrollHeight > wrap.clientHeight + 4;
    wrap.classList.toggle('has-overflow', hasOverflow);
    const atEnd = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 8;
    wrap.classList.toggle('is-scrolled-end', atEnd || !hasOverflow);
  };
  wrap.removeEventListener('scroll', wrap._fadeCheck || (() => {}));
  wrap._fadeCheck = check;
  wrap.addEventListener('scroll', check, { passive: true });
  check();
}

// 2.9 — Yuqoridagi setupChipScrollFade() bilan bir xil g'oya, lekin
// gorizontal (worker-feed-scroll-wrap) uchun: fade-indikator wrapId
// elementiga qo'yiladi, lekin scroll o'zi (scrollWidth/scrollLeft)
// scrollId elementida kuzatiladi — chunki wrap faqat vizual chegara,
// haqiqiy scroll konteyner ichidagi .worker-feed-grid.
function setupHorizontalScrollFade(wrapId, scrollId) {
  const wrap = document.getElementById(wrapId);
  const scroller = document.getElementById(scrollId);
  if (!wrap || !scroller) return;
  const check = () => {
    const hasOverflow = scroller.scrollWidth > scroller.clientWidth + 4;
    wrap.classList.toggle('has-overflow', hasOverflow);
    const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 8;
    wrap.classList.toggle('is-scrolled-end', atEnd || !hasOverflow);
  };
  scroller.removeEventListener('scroll', scroller._fadeCheck || (() => {}));
  scroller._fadeCheck = check;
  scroller.addEventListener('scroll', check, { passive: true });
  check();
}

// Qayta ishlatiladigan chip toggle — search-filters ekranida ham
// aynan shu funksiya ishlatiladi (brief: "4-ekran bilan bir xil
// komponent qayta ishlatiladi")
function toggleChip(chipEl, targetArray, nextBtnId) {
  haptic.selection(); // 3.6: bir nechta variant orasida tanlov o'zgarishi
  const skillId = chipEl.dataset.skill;
  const idx = targetArray.indexOf(skillId);
  if (idx === -1) {
    targetArray.push(skillId);
    chipEl.classList.add('selected');
    chipEl.setAttribute('aria-checked', 'true');
  } else {
    targetArray.splice(idx, 1);
    chipEl.classList.remove('selected');
    chipEl.setAttribute('aria-checked', 'false');
  }
  // Mikro-animatsiya (pop)
  chipEl.classList.remove('is-pop');
  void chipEl.offsetWidth;
  chipEl.classList.add('is-pop');
  chipEl.addEventListener('animationend', () => chipEl.classList.remove('is-pop'), { once: true });

  if (nextBtnId) {
    const btn = document.getElementById(nextBtnId);
    if (btn) btn.classList.toggle('is-disabled', targetArray.length === 0);
  }
  // Badge faqat skills ekranida
  if (targetArray === appState.skills) updateSkillsCountBadge();
  // 2.10: qidiruv filtri ekranida — "Qidirish (n)" tugma matni
  if (targetArray === searchFilterState.skills) updateSearchButtonBadge();
}

function goNextAfterSkills() {
  if (appState.skills.length === 0) return;
  go('region-select');
}

// ------------------------------------------------------------
// 5. HUDUD TANLASH — Bottom sheet mantig'i
// MANTIQ: uchta bosqichli tanlov (viloyat -> tuman -> mahalla)
// bitta universal bottom-sheet komponenti orqali ishlaydi.
// `openSheet(type)` sheet turini biladi va MOCK_* massivdan
// tegishli ro'yxatni chizadi. Filter qidiruv shu ro'yxat ustida
// ishlaydi (client-side .filter(), real backend'da bu server-side
// qidiruvga aylanadi).
// ------------------------------------------------------------
let currentSheetType = null;   // 'viloyat' | 'tuman' | 'mahalla'
let currentSheetItems = [];
let sheetIsFilterMode = false; // true bo'lsa -> search-filters ekrani uchun

const SHEET_EMPTY_ICON = `<div class="sheet-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></div>`;
const SHEET_CHECK_SVG = `<span class="sheet-item-check" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>`;

function getSheetSelectedValue() {
  const state = sheetIsFilterMode ? searchFilterState : appState;
  if (currentSheetType === 'viloyat') return state.region;
  if (currentSheetType === 'tuman') return state.district;
  if (currentSheetType === 'mahalla') return state.mahalla;
  return null;
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return escapeHtml(text);
  const before = escapeHtml(text.slice(0, idx));
  const match = escapeHtml(text.slice(idx, idx + q.length));
  const after = escapeHtml(text.slice(idx + q.length));
  return `${before}<mark>${match}</mark>${after}`;
}

async function openSheet(type, isFilter = false) {
  sheetIsFilterMode = isFilter;
  const state = isFilter ? searchFilterState : appState;

  if (type === 'tuman' && !state.region) return;
  if (type === 'mahalla' && !state.district) return;

  currentSheetType = type;
  _sheetSearchQuery = '';

  if (type === 'viloyat') {
    currentSheetItems = MOCK_REGIONS;
    document.getElementById('sheet-title').textContent = 'Viloyatni tanlang';
  } else if (type === 'tuman') {
    document.getElementById('sheet-title').textContent = 'Tumanni tanlang';
    currentSheetItems = await ensureDistrictsLoaded(state.region);
    if (currentSheetType !== 'tuman') return; // shu orada foydalanuvchi sheet'ni yopgan/boshqa turga o'tgan bo'lishi mumkin
  } else if (type === 'mahalla') {
    document.getElementById('sheet-title').textContent = 'Mahallani tanlang';
    currentSheetItems = await ensureMahallasLoaded(state.district);
    if (currentSheetType !== 'mahalla') return;
  }

  document.getElementById('sheet-search-input').value = '';
  if (_sheetSearchTimer) { clearTimeout(_sheetSearchTimer); _sheetSearchTimer = null; }
  setSheetSearchTyping(false);
  renderSheetList(currentSheetItems);

  const sheet = document.getElementById('region-sheet');
  sheet.style.transform = '';
  sheet.classList.add('open');
  document.getElementById('region-sheet-backdrop').classList.add('open');
}

function closeSheet() {
  const sheet = document.getElementById('region-sheet');
  sheet.classList.remove('open', 'is-dragging');
  sheet.style.transform = '';
  document.getElementById('region-sheet-backdrop').classList.remove('open');
  if (_sheetSearchTimer) { clearTimeout(_sheetSearchTimer); _sheetSearchTimer = null; }
  setSheetSearchTyping(false);
}

let _sheetSearchQuery = '';

function renderSheetList(items, query) {
  const list = document.getElementById('sheet-list');
  list.innerHTML = '';
  list.setAttribute('role', 'listbox');
  const q = (query !== undefined ? query : _sheetSearchQuery) || '';
  if (items.length === 0) {
    list.innerHTML = `<div class="sheet-empty">${SHEET_EMPTY_ICON}<span>Hech narsa topilmadi — boshqa so\'z bilan qidirib ko\'ring</span></div>`;
    return;
  }
  const selected = getSheetSelectedValue();
  items.forEach(item => {
    const row = document.createElement('div');
    const isSelected = item === selected;
    row.className = 'sheet-item' + (isSelected ? ' is-selected' : '');
    row.innerHTML = `<span class="sheet-item-label">${highlightMatch(item, q)}</span>${SHEET_CHECK_SVG}`;
    // A11y: bottom-sheet ro'yxati — listbox/option pattern.
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    row.tabIndex = 0;
    row.onkeydown = (e) => handleCardKeydown(e);
    row.onclick = () => selectSheetItem(item);
    list.appendChild(row);
  });
}

// ------------------------------------------------------------
// 8.2 — Debounce + typing holati (sheet qidiruv)
// Har harfda filter o'rniga 220ms kutib, shu paytda kichik spinner
// ko'rsatiladi. Bo'sh so'rovda darhol filter (kutish shart emas).
// ------------------------------------------------------------
let _sheetSearchTimer = null;

function setSheetSearchTyping(on) {
  const wrap = document.getElementById('sheet-search-wrap');
  if (!wrap) return;
  wrap.classList.toggle('is-typing', !!on);
}

function filterSheetList(query) {
  _sheetSearchQuery = (query || '').trim();
  const q = _sheetSearchQuery.toLowerCase();
  const filtered = currentSheetItems.filter(item => item.toLowerCase().includes(q));
  renderSheetList(filtered, _sheetSearchQuery);
  setSheetSearchTyping(false);
}

function onSheetSearchInput(value) {
  // Bo'sh yoki bitta belgi — darhol; aks holda debounce
  if (_sheetSearchTimer) clearTimeout(_sheetSearchTimer);
  const raw = value || '';
  if (raw.trim().length === 0) {
    filterSheetList('');
    return;
  }
  setSheetSearchTyping(true);
  _sheetSearchTimer = setTimeout(() => {
    filterSheetList(raw);
  }, 220);
}

/* 2.5 — Drag-to-close */
(function initSheetDrag() {
  const sheet = () => document.getElementById('region-sheet');
  let startY = 0;
  let currentY = 0;
  let dragging = false;

  function onStart(e) {
    const el = sheet();
    if (!el || !el.classList.contains('open')) return;
    // faqat handle yoki header yuqorisidan
    const t = e.target;
    if (!t.closest('.sheet-handle') && !t.closest('.sheet-header')) return;
    // search input ichida drag yo'q
    if (t.closest('input')) return;
    dragging = true;
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    currentY = 0;
    el.classList.add('is-dragging');
  }
  function onMove(e) {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    currentY = Math.max(0, y - startY);
    sheet().style.transform = `translateY(${currentY}px)`;
    if (e.cancelable) e.preventDefault();
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    const el = sheet();
    el.classList.remove('is-dragging');
    if (currentY > 100) {
      closeSheet();
    } else {
      el.style.transform = '';
    }
    currentY = 0;
  }

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  document.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
})();

/* ------------------------------------------------------------
   2.9 — Pull-to-refresh (Home feed, employer)
   MANTIQ: faqat `home` ekranida, employer rolida VA feed
   konteyneri (`.screen[data-screen="home"]`) scrollTop===0
   bo'lganda ishga tushadi — aks holda oddiy ichki scroll bilan
   to'qnashib qoladi. Chegara (THRESHOLD)dan o'tib qo'yib
   yuborilsa, mavjud `renderHome()` qayta chaqiriladi — u allaqachon
   skeleton + 500ms sun'iy kechikish bilan feed'ni qayta yuklaydi
   (backend so'rovini simulyatsiya qiladigan bir xil mantiq),
   shuning uchun bu yerda alohida "refresh" logikasi dublikat
   qilinmadi.
------------------------------------------------------------ */
// ------------------------------------------------------------
// TOPBAR SCROLL SHADOW (3.5 roadmap punkti)
// MANTIQ: hozirgacha scroll qilinganda topbar bilan content orasida
// hech qanday vizual chegara yo'q edi — ikkalasi bir xil `--color-bg`
// fon, shuning uchun scroll qilib pastga tushganda topbar "havoda
// osilib turganday" emas, contentga yopishib turganday tuyuladi.
// Yechim: haqiqiy scroll konteyner `.screen-content` (DIQQAT: `.screen`
// emas — u flex-column, ichidagi `.screen-content` flex:1 + o'zining
// overflow-y:auto bilan scroll qiladi, `.screen` darajasida overflow
// yuzaga kelmaydi; bu xato dastlab shu funksiyada ham, eski
// pull-to-refresh kodida ham bor edi, ikkalasi ham shu auditda
// tuzatildi — qarang: initPullToRefresh) 0'dan chetlashishi bilan
// topbar'ga `.has-shadow` class qo'shiladi. Bitta global scroll
// listener (capture: true, chunki `.screen-content` DOM'da chuqurroq,
// bubble emas) har bir scroll hodisasida faqat AKTIV ekranni
// tekshiradi — 12+ ekran uchun alohida-alohida listener yozish
// shart emas.
// ------------------------------------------------------------
(function initTopbarScrollShadow() {
  const SHADOW_THRESHOLD = 4; // shuncha piksel scroll qilinsa shadow chiqadi

  function onScroll(e) {
    const content = e.target;
    if (!content.classList || !content.classList.contains('screen-content')) return;
    const screen = content.closest('.screen');
    if (!screen) return;
    const topbar = screen.querySelector('.topbar');
    if (!topbar) return; // ba'zi ekranlarda (masalan home) topbar umuman yo'q
    topbar.classList.toggle('has-shadow', content.scrollTop > SHADOW_THRESHOLD);
  }

  document.addEventListener('scroll', onScroll, true); // capture: chunki .screen-content ichki element
})();

// ------------------------------------------------------------
// EDGE SWIPE-BACK (3.2 roadmap punkti)
// MANTIQ: iOS'dagi tanish gesture — ekranning eng CHAP chetidan
// (birinchi ~24px) boshlab o'ngga tortish, "orqaga" qaytaradi.
// Nega faqat chap chetdan boshlanishi shart? Chunki agar butun
// ekran bo'ylab har qanday o'ngga surish orqaga qaytarsa, u holda
// oddiy gorizontal scroll (masalan chip-lar qatori, karusel) bilan
// to'qnashadi — foydalanuvchi chip'larni ko'rmoqchi bo'lib,
// tasodifan orqaga chiqib ketadi. Faqat "yon panel tortish" zonasi
// xavfsiz, chunki u yerda odatda interaktiv gorizontal-scroll
// elementlar joylashmaydi.
//
// Qaysi ekranlarda ishlaydi? Faqat "orqaga" tugmasi (`goBack()`)
// bor ekranlarda — bu qattiq ro'yxat emas, DOM'dan dinamik
// tekshiriladi (`.topbar .icon-btn[onclick="goBack()"]`), shunday
// qilib yangi ekran qo'shilganda alohida "swipe-back ro'yxati"ni
// yangilash kerak bo'lmaydi — orqaga tugmasi bo'lsa, gesture ham
// avtomatik ishlaydi.
// ------------------------------------------------------------
(function initSwipeBack() {
  const EDGE_ZONE = 24;       // faqat shu chetdan boshlangan surtish hisobga olinadi
  const THRESHOLD = 90;       // shuncha piksel tortilsa — orqaga qaytadi
  const MAX_DRAG = 140;       // vizual cheklov, undan ortiq surilmaydi
  let dragging = false;
  let startX = 0;
  let dx = 0;
  let activeScreen = null;

  function screenHasBackButton(screen) {
    return !!screen.querySelector('.topbar .icon-btn[onclick="goBack()"]');
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function onStart(e) {
    if (reducedMotion()) return; // vizual drag-feedback berilmaydi, tugma orqali orqaga qaytish yetarli
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    if (x > EDGE_ZONE) return; // faqat chap chetdan
    const screen = document.querySelector('.screen.active');
    if (!screen || !screenHasBackButton(screen)) return;
    dragging = true;
    startX = x;
    dx = 0;
    activeScreen = screen;
    activeScreen.classList.add('is-swipe-dragging');
  }
  function onMove(e) {
    if (!dragging) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    dx = Math.max(0, Math.min(MAX_DRAG, x - startX));
    activeScreen.style.transform = `translateX(${dx}px)`;
    if (e.cancelable && dx > 4) e.preventDefault();
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    activeScreen.classList.remove('is-swipe-dragging');
    if (dx >= THRESHOLD) {
      // Snap-out: ekranni to'liq o'ngga chiqarib, keyin orqaga qaytamiz —
      // shunda goBack()ning o'z "dir-back" animatsiyasi tabiiy davom etadi.
      activeScreen.style.transition = 'transform 0.18s ease-out';
      activeScreen.style.transform = `translateX(${window.innerWidth}px)`;
      const screenToClean = activeScreen;
      setTimeout(() => {
        screenToClean.style.transition = '';
        screenToClean.style.transform = '';
        goBack();
      }, 180);
    } else {
      // Chegaradan o'tmadi — joyiga qaytadi
      activeScreen.style.transition = 'transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)';
      activeScreen.style.transform = '';
      setTimeout(() => { if (activeScreen) activeScreen.style.transition = ''; }, 200);
    }
    dx = 0;
    activeScreen = null;
  }

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  // Sichqoncha bilan test qilish uchun (desktop preview) — sheet-drag
  // va pull-to-refresh bilan bir xil ikki-mode pattern.
  document.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
})();

(function initPullToRefresh() {
  const THRESHOLD = 64;
  const MAX_PULL = 90;
  const RESISTANCE = 0.5;
  let startY = 0;
  let distance = 0;
  let pulling = false;
  let refreshing = false;

  // BUG TUZATISH (3.5 diagnostikasi paytida topildi): `homeScreen()`
  // avval `.screen[data-screen="home"]`ni qaytarardi va uning
  // scrollTop'i tekshirilardi — lekin `.screen`ning o'zi hech qachon
  // scroll BO'LMAYDI (u flex-column, ichidagi `.screen-content` esa
  // flex:1 + o'ZINING overflow-y:auto bilan haqiqiy scroll qiladi,
  // `.screen-content'dan tashqarida `.screen` darajasida overflow
  // yuzaga kelmaydi). Demak `screen.scrollTop` doim 0 edi — "faqat
  // tepada bo'lsa ishga tushsin" tekshiruvi HAQIQATDA HECH NARSANI
  // filtrlamasdi, PTR feed chuqur scroll qilingan holatda ham
  // ishga tushishi mumkin edi. Endi haqiqiy scroll konteyner —
  // `.screen-content` — qaytariladi.
  function homeScrollEl() {
    const screen = document.querySelector('.screen[data-screen="home"]');
    return screen ? screen.querySelector('.screen-content') : null;
  }
  function indicator() { return document.getElementById('ptr-indicator'); }

  function onStart(e) {
    if (currentScreen !== 'home' || appState.role !== 'employer' || refreshing) return;
    const scrollEl = homeScrollEl();
    if (!scrollEl || scrollEl.scrollTop > 0) return;
    // Faqat feed maydoni ichida boshlansin — pastki tab-bar yoki
    // boshqa interaktiv elementlar bilan to'qnashmasin.
    if (e.target.closest('.action-card, .tab-bar')) return;
    pulling = true;
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    distance = 0;
    const ind = indicator();
    if (ind) ind.classList.add('is-dragging');
  }
  function onMove(e) {
    if (!pulling) return;
    const scrollEl = homeScrollEl();
    if (!scrollEl || scrollEl.scrollTop > 0) { pulling = false; resetIndicator(); return; }
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const raw = y - startY;
    if (raw <= 0) { distance = 0; updateIndicator(0); return; }
    distance = Math.min(MAX_PULL, raw * RESISTANCE);
    updateIndicator(distance);
    if (e.cancelable) e.preventDefault();
  }
  function onEnd() {
    if (!pulling) return;
    pulling = false;
    const ind = indicator();
    if (ind) ind.classList.remove('is-dragging');
    if (distance >= THRESHOLD) {
      triggerRefresh();
    } else {
      resetIndicator();
    }
    distance = 0;
  }

  function updateIndicator(d) {
    const ind = indicator();
    if (!ind) return;
    ind.style.transform = `translateY(${d}px)`;
    ind.style.opacity = String(Math.min(1, d / THRESHOLD));
    ind.classList.toggle('is-armed', d >= THRESHOLD);
  }
  function resetIndicator() {
    const ind = indicator();
    if (!ind) return;
    ind.classList.remove('is-dragging', 'is-armed');
    ind.style.transform = '';
    ind.style.opacity = '';
  }
  function triggerRefresh() {
    const ind = indicator();
    if (!ind) return;
    refreshing = true;
    ind.classList.remove('is-armed');
    ind.classList.add('is-refreshing');
    ind.style.transform = `translateY(${THRESHOLD}px)`;
    ind.style.opacity = '1';
    renderHome();
    // renderHome() ichidagi skeleton kechikishi 500ms — indikator
    // shundan biroz uzoqroq turib, keyin joyiga qaytadi, aks holda
    // feed va indikator bir vaqtda "sakrab" ko'rinadi.
    setTimeout(() => {
      refreshing = false;
      ind.classList.remove('is-refreshing');
      resetIndicator();
    }, 650);
  }

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  document.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
})();

// A11y: `disabled` klassini `tabindex`/`aria-disabled` bilan sinxronda ushlab turadi.
// Sabab: CSS klass vizual jihatdan disabled qilib qo'yishi mumkin, lekin agar
// tabindex="0" bo'lib qolsa, klaviatura foydalanuvchisi hamon Tab bilan borib,
// Enter bosib "ishlamaydigan" tugmaga urinadi — bu screen-reader userlar uchun
// tuzoq: element bor, deyiladi "tugma", lekin hech narsa qilmaydi, tushuntirilmaydi.
function setSelectorDisabled(id, isDisabled) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('disabled', isDisabled);
  el.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
  el.tabIndex = isDisabled ? -1 : 0;
}

function selectSheetItem(value) {
  haptic.selection(); // 3.6: bottom-sheet'dan variant tanlash — picker hissi
  const state = sheetIsFilterMode ? searchFilterState : appState;
  const prefix = sheetIsFilterMode ? 'filter-sel-' : 'sel-';

  if (currentSheetType === 'viloyat') {
    state.region = value;
    state.district = null;
    if (!sheetIsFilterMode) state.mahalla = null;
    setSelectorValue(prefix + 'viloyat', value);
    setSelectorValue(prefix + 'tuman', 'Tumanni tanlang', false);
    setSelectorDisabled(prefix + 'tuman', false);
    if (!sheetIsFilterMode) {
      setSelectorValue(prefix + 'mahalla', 'Mahallani tanlang', false);
      setSelectorDisabled(prefix + 'mahalla', true);
    }
  } else if (currentSheetType === 'tuman') {
    state.district = value;
    if (!sheetIsFilterMode) state.mahalla = null;
    setSelectorValue(prefix + 'tuman', value);
    if (!sheetIsFilterMode) {
      setSelectorValue(prefix + 'mahalla', 'Mahallani tanlang', false);
      setSelectorDisabled(prefix + 'mahalla', false);
    }
  } else if (currentSheetType === 'mahalla') {
    state.mahalla = value;
    setSelectorValue(prefix + 'mahalla', value);
  }

  closeSheet();
  if (!sheetIsFilterMode) updateRegionNextBtn();
  if (sheetIsFilterMode) updateSearchButtonBadge();
}

function setSelectorValue(elId, text, filled = true) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.querySelector('.selector-value').textContent = text;
  el.classList.toggle('filled', filled);
}

function updateRegionNextBtn() {
  const btn = document.getElementById('region-next-btn');
  const ready = appState.region && appState.district && appState.mahalla;
  btn.classList.toggle('is-disabled', !ready);
}

function goAfterRegion() {
  if (!appState.region || !appState.district || !appState.mahalla) return;
  // MANTIQ: aniq manzil qadami faqat worker uchun (va ixtiyoriy).
  // Employer to'g'ridan-to'g'ri telefon qadamiga o'tadi.
  if (appState.role === 'worker') {
    go('address-input');
  } else {
    go('phone-share');
  }
}

// ------------------------------------------------------------
// 6. ANIQ MANZIL (ixtiyoriy)
// ------------------------------------------------------------
function goNextAfterAddress() {
  appState.address = document.getElementById('address-field').value.trim();
  go('phone-share');
}

function skipAddress() {
  appState.address = '';
  go('phone-share');
}

// ------------------------------------------------------------
// 7. TELEFON
// MANTIQ: Real Telegram Mini App'da bu joyda
// Telegram.WebApp.requestContact() chaqiriladi. Demo'da API yo'q,
// shuning uchun hardcoded mock qiymat bilan simulyatsiya qilinadi —
// lekin funksiya nomi va joylashuvi productionga tayyor.
// ------------------------------------------------------------
function applyTelegramUserDefaults() {
  const tg = getTg();
  if (!tg || !tg.initDataUnsafe || !tg.initDataUnsafe.user) return;
  const u = tg.initDataUnsafe.user;
  if (!appState.name && (u.first_name || u.last_name)) {
    appState.name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  }
  if (u.phone_number) {
    appState.phone = u.phone_number.startsWith('+') ? u.phone_number : ('+' + u.phone_number);
  }
}

function sharePhone() {
  const tg = getTg();
  // Real Telegram Mini App: kontakt so'rash (raqam botga ketadi;
  // frontend demo uchun muvaffaqiyatdan keyin flow davom etadi)
  if (tg && typeof tg.requestContact === 'function' && isTelegramMiniApp()) {
    try {
      const done = (ok) => {
        if (ok) {
          applyTelegramUserDefaults();
          if (!appState.phone) appState.phone = '+998901112233';
          finishRegistration();
        } else {
          showToast('Raqam ulashilmadi — qo\'lda kiriting', 'info');
        }
      };
      // API variantlari: callback yoki contactRequested event
      if (typeof tg.onEvent === 'function') {
        const onContact = (payload) => {
          try { tg.offEvent('contactRequested', onContact); } catch (e) {}
          const status = payload && payload.status;
          done(status === 'sent' || status === true || payload === true);
        };
        tg.onEvent('contactRequested', onContact);
      }
      const ret = tg.requestContact(done);
      if (ret && typeof ret.then === 'function') {
        ret.then(() => done(true)).catch(() => done(false));
      }
      return;
    } catch (e) {
      /* fallback mock */
    }
  }
  applyTelegramUserDefaults();
  if (!appState.phone) appState.phone = '+998901112233';
  finishRegistration();
}

function checkManualPhone() {
  const val = document.getElementById('manual-phone-field').value.trim();
  const pwdEl = document.getElementById('reg-password-field');
  const pwd = pwdEl ? pwdEl.value : '';
  // Telefon majburiy; parol bo'sh yoki ≥4 belgi bo'lishi mumkin
  const phoneOk = val.length >= 9;
  const pwdOk = !pwd || pwd.length >= 4;
  document.getElementById('manual-phone-next-btn').classList.toggle('is-disabled', !(phoneOk && pwdOk));
  clearFieldError('field-manual-phone');
  clearFieldError('field-reg-password');
}

function submitManualPhone() {
  const val = document.getElementById('manual-phone-field').value.trim();
  if (val.length < 9) {
    setFieldError('field-manual-phone');
    return;
  }
  const pwdEl = document.getElementById('reg-password-field');
  const pwd = pwdEl ? pwdEl.value : '';
  if (pwd && pwd.length < 4) {
    setFieldError('field-reg-password');
    return;
  }
  appState.phone = val;
  appState.password = pwd || null;
  finishRegistration();
}

// MANTIQ: ro'yxatdan o'tish endi backend'ga yoziladi (POST /api/workers
// yoki /api/employers) — muvaffaqiyatli javobdan olingan `id` appState.id
// ga saqlanadi. Ixtiyoriy password brauzer-demo login uchun yuboriladi.
async function finishRegistration() {
  try {
    const payload = {
      name: appState.name,
      phone: appState.phone,
      region: appState.region,
      district: appState.district,
      mahalla: appState.mahalla,
      address: appState.address
    };
    if (appState.password) payload.password = appState.password;
    // Telegram Mini App bo'lsa telegram_id ni ham yozamiz
    const tg = getTg();
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) {
      payload.telegram_id = tg.initDataUnsafe.user.id;
    }
    let created;
    if (appState.role === 'worker') {
      created = await ChaqirAPI.registerWorker({ ...payload, skills: appState.skills });
    } else {
      created = await ChaqirAPI.registerEmployer(payload);
    }
    appState.id = created.id;
    appState.token = created.token || null;
    appState.password = null; // xotiradan o'chiramiz
    setStoredToken(appState.token);
  } catch (e) {
    console.error('Ro\'yxatdan o\'tishda xatolik:', e);
    showToast(e.message || 'Ro\'yxatdan o\'tishda xatolik yuz berdi', 'error');
    haptic.error();
    return;
  }

  document.getElementById('welcome-name').textContent = `Xush kelibsiz, ${appState.name}`;
  screenHistory = [];
  renderScreen('success');
}

// ------------------------------------------------------------
// 2.7 — CONFETTI (success ekrani)
// MANTIQ: har bir zarracha — pozitsiya (--x), o'lcham, rang,
// tushish uzunligi, aylanish burchagi va kechikish JS'da tasodifiy
// hisoblanadi, CSS'ga custom property orqali uzatiladi (bitta
// @keyframes barcha zarrachalar uchun ishlaydi, faqat parametrlar
// farq qiladi — GPU-friendly, DOM'da og'ir emas).
// prefers-reduced-motion: reduce bo'lgan foydalanuvchilarga
// zarracha umuman yaratilmaydi — accessibility ustuvor.
// ------------------------------------------------------------
function fireConfetti() {
  const container = document.getElementById('confetti-container');
  if (!container) return;
  container.innerHTML = '';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = [
    'var(--color-primary)',
    'var(--color-primary-dark)',
    'var(--color-success)',
    'var(--color-warning)',
    'var(--color-info)'
  ];
  const PIECE_COUNT = 32;

  for (let i = 0; i < PIECE_COUNT; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece' + (Math.random() < 0.5 ? ' is-round' : '');
    const size = 5 + Math.random() * 6; // 5–11px
    piece.style.setProperty('--x', `${Math.random() * 100}%`);
    piece.style.setProperty('--size', `${size}px`);
    piece.style.setProperty('--piece-color', colors[Math.floor(Math.random() * colors.length)]);
    piece.style.setProperty('--fall-distance', `${420 + Math.random() * 220}px`);
    piece.style.setProperty('--spin', `${(Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 360)}deg`);
    piece.style.setProperty('--dur', `${1.8 + Math.random() * 1.2}s`);
    piece.style.setProperty('--delay', `${Math.random() * 0.5}s`);
    container.appendChild(piece);
  }

  // Animatsiya tugagach DOM'ni tozalaymiz — ekranga qayta kirilganda
  // eski zarrachalar bilan yangilari aralashib ketmasligi uchun.
  setTimeout(() => { if (container) container.innerHTML = ''; }, 3200);
}

// ------------------------------------------------------------
// 9. LOGIN — haqiqiy auth (Telegram initData yoki demo telefon)
// Asosiy yo'l: Telegram Mini App ichida POST /api/auth/telegram
// (HMAC tekshiruvli). Brauzer-demo: avval telefon bo'yicha
// foydalanuvchini topamiz (eski endpoint), keyin agar parol
// bo'lmasa ham session yo'q — lekin demo uchun by-phone bilan
// davom etiladi. Token faqat register yoki auth/* orqali keladi.
// ------------------------------------------------------------
function applyAuthUser(user, token) {
  if (token) {
    appState.token = token;
    setStoredToken(token);
  }
  appState.id = user.id;
  appState.role = user.role;
  appState.name = user.name;
  appState.phone = user.phone;
  appState.region = user.region;
  appState.district = user.district;
  appState.mahalla = user.mahalla;
  appState.address = user.address;
}

async function tryLoginByTelegram() {
  const tg = getTg();
  if (!tg || !tg.initData || !isTelegramMiniApp()) return false;
  try {
    const res = await ChaqirAPI.loginTelegram(tg.initData);
    if (res && res.user) {
      applyAuthUser(res.user, res.token);
      return true;
    }
  } catch (e) {
    // 404 = hali ro'yxatdan o'tmagan — frontend registratsiyaga yo'naltiradi
    console.warn('Telegram auth:', e.message || e);
  }
  return false;
}

async function tryLoginByPassword(phone, password) {
  try {
    const res = await ChaqirAPI.loginPassword(phone, password);
    if (res && res.user) {
      applyAuthUser(res.user, res.token);
      return true;
    }
  } catch (e) {
    console.warn('Password login:', e.message || e);
    throw e;
  }
  return false;
}

async function loginShare() {
  applyTelegramUserDefaults();
  if (!appState.phone) appState.phone = '+998901112233';

  // Avval Telegram initData orqali haqiqiy auth
  if (await tryLoginByTelegram()) {
    await goHome();
    return;
  }

  const tg = getTg();
  if (tg && typeof tg.requestContact === 'function' && isTelegramMiniApp()) {
    try {
      tg.requestContact(async (ok) => {
        if (ok) applyTelegramUserDefaults();
        // Telegram contact ulashganda ham token kerak — password yo'q,
        // shuning uchun faqat telegram auth ishlasa home'ga o'tamiz.
        if (await tryLoginByTelegram()) {
          await goHome();
          return;
        }
        showToast('Avval ro\'yxatdan o\'ting yoki parol bilan kiring', 'info');
        go('login-manual-phone');
      });
      return;
    } catch (e) {}
  }
  // Brauzerda "Raqamni ulashish" — parol formaga yo'naltiramiz
  go('login-manual-phone');
}

// MANTIQ: "Qo'lda kiritish" — telefon + parol bilan POST /api/auth/login
function checkLoginPhone() {
  const phone = document.getElementById('login-phone-field').value.trim();
  const pwdEl = document.getElementById('login-password-field');
  const pwd = pwdEl ? pwdEl.value : '';
  const ok = phone.length >= 9 && pwd.length >= 4;
  document.getElementById('login-phone-next-btn').classList.toggle('is-disabled', !ok);
  clearFieldError('field-login-phone');
  clearFieldError('field-login-password');
}

async function loginManualSubmit() {
  const phone = document.getElementById('login-phone-field').value.trim();
  const pwdEl = document.getElementById('login-password-field');
  const password = pwdEl ? pwdEl.value : '';
  if (phone.length < 9) {
    setFieldError('field-login-phone');
    return;
  }
  if (password.length < 4) {
    setFieldError('field-login-password');
    return;
  }
  appState.phone = phone;
  const btn = document.getElementById('login-phone-next-btn');
  if (btn) btn.classList.add('is-disabled');
  try {
    const ok = await tryLoginByPassword(phone, password);
    if (ok) {
      await goHome();
      return;
    }
    showToast('Kirish muvaffaqiyatsiz', 'error');
  } catch (e) {
    showToast(e.message || 'Telefon yoki parol noto\'g\'ri', 'error');
    haptic.error();
  } finally {
    if (btn) btn.classList.remove('is-disabled');
    checkLoginPhone();
  }
}

// ------------------------------------------------------------
// 10. BOSH MENYU
// ------------------------------------------------------------
async function goHome() {
  screenHistory = [];
  // Employer kirganda/ro'yxatdan o'tganda — uning saqlagan
  // ishchilar ro'yxati (favorites) backend'dan oldindan yuklab
  // qo'yiladi, shunda "Saqlangan" tab'i va yurakcha holatlari
  // (isFavorite) darhol to'g'ri ko'rinadi.
  if (appState.id && appState.role === 'employer') {
    try {
      const favs = await ChaqirAPI.getFavorites(appState.id);
      appState.favorites = favs.map(w => w.id);
    } catch (e) {
      console.error('Sevimlilarni yuklashda xatolik:', e);
    }
  }
  renderScreen('home');
}

// ------------------------------------------------------------
// BOTTOM TAB BAR
// MANTIQ: tab bosilganda screenHistory to'liq TOZALANADI — chunki
// tab navigatsiyasi "orqaga qaytish" zanjiridan mustaqil: foydalanuvchi
// "Profil" tabini bossa-yu keyin "Bosh sahifa"ni bossa, orqaga tugmasi
// uni "Profil"ga emas, onboarding'ga olib borishi kerak emas — tab
// har doim yangi, mustaqil boshlanish nuqtasi hisoblanadi.
//
function switchTab(tabName) {
  const targetScreen = getTabScreenMap()[tabName];
  if (!targetScreen) return;

  haptic.light(); // 3.6: tab almashish — kichik, tez-tez bosiladigan harakat
  screenHistory = [];
  renderScreen(targetScreen, 'fade');
}

function renderHome() {
  const initial = (appState.name || 'F').trim().charAt(0).toUpperCase();
  document.getElementById('home-avatar').textContent = initial;
  document.getElementById('home-name').textContent = appState.name || 'Foydalanuvchi';
  document.getElementById('home-role').textContent = appState.role === 'worker' ? 'Ishchi' : 'Ish qidiruvchi';

  document.getElementById('home-employer-block').style.display = appState.role === 'employer' ? 'block' : 'none';
  document.getElementById('home-worker-block').style.display = appState.role === 'worker' ? 'block' : 'none';

  // MANTIQ: employer kirishi bilan (Uzum Market kabi) tavsiya feed'i
  // darhol ko'rinadi — qidiruv filtrini kutmasdan. Bu real backend'da
  // GET /api/workers?recommended=true so'roviga aylanadi, shuning
  // uchun bu yerda ham skeleton + sun'iy kechikish bilan simulyatsiya
  // qilinadi (runSearch bilan bir xil mantiq).
  if (appState.role === 'employer') {
    const grid = document.getElementById('home-worker-feed');
    renderFeedCardSkeletons(grid, 4);
    setTimeout(() => {
      if (currentScreen === 'home') renderHomeFeed();
    }, 500);
  }
}

function renderHomeFeed() {
  const grid = document.getElementById('home-worker-feed');
  grid.innerHTML = '';
  // 2.9: stagger-animatsiya — har bir kartaga --stagger-index custom
  // property beriladi, CSS (`feed-card-in` + calc()) shu index'dan
  // kechikishni o'zi hisoblab chiqadi. Karta soni o'zgarsa ham
  // (masalan kelajakda backend ko'proq worker qaytarsa) JS tomonda
  // hech narsa o'zgartirish kerak emas — CSS min() bilan uzoq
  // ro'yxatlarda ham kechikishni cheklab qo'yadi.
  MOCK_WORKERS.forEach((worker, index) => {
    const card = document.createElement('div');
    card.className = 'worker-feed-card';
    card.style.setProperty('--stagger-index', index);
    // A11y: bu karta butun ilovaning asosiy "value proposition"i — worker
    // topish. role="button" + tabindex + aria-label bo'lmasa, klaviatura va
    // screen-reader foydalanuvchi bu ekranda umuman ishlay olmaydi.
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${worker.name}, ${worker.skills[0]}, reyting ${worker.rating.toFixed(1)}`);
    card.onclick = () => openWorkerDetailFromList(worker);
    card.onkeydown = (e) => handleCardKeydown(e);
    card.innerHTML = `
      ${renderAvatar(worker)}
      <div class="worker-feed-card-name">${worker.name}</div>
      <div class="worker-feed-card-skill">${worker.skills[0]}</div>
      ${renderRatingBadge(worker)}
    `;
    grid.appendChild(card);
  });
  // 2.9: horizontal karusel — scroll o'ng chetida fade-edge
  // ko'rsatish/yashirish (mavjud setupChipScrollFade bilan bir xil
  // mantiq, gorizontal o'qqa moslashtirilgan).
  requestAnimationFrame(() => setupHorizontalScrollFade('home-worker-feed-wrap', 'home-worker-feed'));
}

// Reyting badge — worker-card, feed-card va detail ekranida bir xil
// formatda qayta ishlatiladi.
function renderRatingBadge(worker) {
  const starSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  return `<div class="rating-badge"><span class="star">${starSvg}</span>${worker.rating.toFixed(1)} <span class="rating-count">(${worker.reviewCount})</span></div>`;
}

// ------------------------------------------------------------
// 2.9 — AVATAR (harf-fallback + real rasm skeleton)
// MANTIQ: hozirgi mock data'da hech qaysi workerda avatarUrl yo'q,
// faqat avatarColor + ism bosh harfi bor — shuning uchun bu yerdan
// pastdagi "rasm bor" tarmog'i hech qachon ishga tushmaydi va
// vizual ko'rinish o'zgarmaydi. Lekin real backend'da worker profil
// rasm yuklaganda tayyor bo'lishi uchun oldindan qurilgan: rasm
// yuklanayotganda mavjud skeleton-shimmer ko'rinadi, onload'da
// fade-in bilan almashadi, onerror'da esa img olib tashlanib
// harf-avatar asl holicha qoladi (tarmoq yo'q joyda ham UI
// buzilmaydi). worker.name.charAt(0) escapeHtml() orqali o'tadi —
// name bo'lajakda foydalanuvchi kiritgan matn bo'lgani uchun.
// ------------------------------------------------------------
function renderAvatar(worker, sizeClass = '') {
  const cls = `avatar-photo${sizeClass ? ' ' + sizeClass : ''}`;
  const initial = escapeHtml(worker.name.charAt(0));
  if (!worker.avatarUrl) {
    return `<div class="${cls}" style="background:${worker.avatarColor};">${initial}</div>`;
  }
  return `<div class="${cls} avatar-photo--loading" style="background:${worker.avatarColor};">
    <div class="avatar-skeleton-shimmer"></div>
    <span class="avatar-photo-initial">${initial}</span>
    <img src="${worker.avatarUrl}" alt="" class="avatar-photo-img"
      onload="this.closest('.avatar-photo').classList.replace('avatar-photo--loading','avatar-photo--loaded')"
      onerror="const c=this.closest('.avatar-photo'); this.remove(); c.classList.remove('avatar-photo--loading');">
  </div>`;
}

// ------------------------------------------------------------
// BUYURTMALAR (faqat Ishchi) — Buyurtmalar tab'i
// MANTIQ: employer'ning runSearch() bilan bir xil pattern —
// skeleton -> (kechikish) -> data yoki bo'sh holat. Yangi UI
// o'ylab topmaymiz, Bo'lim 4 primitivlarini qayta ishlatamiz.
// XAVFSIZLIK: clientName/skill/mahalla/date escapeHtml() orqali
// o'tadi — bular kelajakda real mijoz kiritgan matn bo'ladi.
// ------------------------------------------------------------
const ORDERS_SIMULATED_DELAY = 450;

async function renderWorkerOrders() {
  const list = document.getElementById('worker-orders-list');
  if (!list) return;
  renderWorkerCardSkeletons(list, 3);

  await refreshWorkerOrders(); // backend'dan GET /api/orders?worker_id=...

  {
    if (currentScreen !== 'worker-orders') return; // boshqa ekranga o'tib ketilgan bo'lsa render qilmaymiz

    if (!MOCK_ORDERS || MOCK_ORDERS.length === 0) {
      renderEmptyState(list, {
        icon: ICON_ORDERS,
        title: 'Hali buyurtma yo\'q',
        body: 'Birinchi so\'rov kelganda shu yerda paydo bo\'ladi — kuting, tez orada ishlar boshlanadi!'
      });
      return;
    }

    list.innerHTML = '';
    MOCK_ORDERS.forEach((order, index) => {
      const card = document.createElement('div');
      card.className = 'worker-card';
      card.style.setProperty('--stagger-index', index);
      const isNew = order.status === 'yangi';
      const actions = isNew ? `
        <div class="worker-card-actions" style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn btn-primary btn-sm" data-order-action="done" data-order-id="${order.id}">Bajarildi</button>
          <button class="btn btn-secondary btn-sm" data-order-action="cancel" data-order-id="${order.id}">Bekor qilish</button>
        </div>` : '';
      card.innerHTML = `
        <div class="worker-card-top worker-card-top--spread">
          <div class="worker-card-mahalla">${escapeHtml(order.skill || '')} · ${escapeHtml(order.mahalla || '')}</div>
          ${renderOrderStatusBadge(order.status)}
        </div>
        <div class="worker-card-mahalla">${escapeHtml(order.clientName || order.client_name || '')}${order.date ? ' · ' + escapeHtml(order.date) : ''}</div>
        ${actions}
      `;
      card.querySelectorAll('[data-order-action]').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const action = btn.getAttribute('data-order-action');
          const status = action === 'done' ? 'bajarilgan' : 'bekor';
          try {
            await ChaqirAPI.updateOrderStatus(order.id, status);
            showToast(status === 'bajarilgan' ? 'Buyurtma bajarildi deb belgilandi' : 'Buyurtma bekor qilindi', 'success');
            haptic.success();
            await renderWorkerOrders();
          } catch (err) {
            showToast(err.message || 'Status yangilanmadi', 'error');
          }
        };
      });
      list.appendChild(card);
    });
  }
}

function renderOrderStatusBadge(status) {
  if (status === 'bekor') {
    return `<span class="order-status-badge">Bekor</span>`;
  }
  const isNew = status === 'yangi';
  const label = isNew ? 'Yangi' : 'Bajarilgan';
  return `<span class="order-status-badge${isNew ? ' is-new' : ' is-done'}">${label}</span>`;
}

// MANTIQ: avval backend'dagi sessionni tugatamiz (POST /api/auth/logout),
// keyin appState va localStorage'dagi tokenni tozalaymiz. Backend so'rovi
// muvaffaqiyatsiz bo'lsa ham (masalan tarmoq yo'q) — foydalanuvchi baribir
// mahalliy holatda "chiqqan" bo'lishi kerak, shuning uchun xato jim
// e'tiborsiz qoldiriladi.
async function logout() {
  try { if (appState.token) await ChaqirAPI.logout(); } catch (e) { /* baribir chiqamiz */ }
  setStoredToken(null);
  appState = { id: null, token: null, role: null, name: '', skills: [], region: null, district: null, mahalla: null, address: '', phone: null, favorites: [] };
  searchFilterState = { skills: [], region: null, district: null };
  screenHistory = [];
  searchAttemptCount = 0; // demo error-simulyatsiya hisoblagichi ham tozalanadi
  renderScreen('onboarding', 'back'); // chiqish — "orqaga" hissi to'g'ri
}

// ------------------------------------------------------------
// 11. QIDIRUV FILTRI
// ------------------------------------------------------------
function renderFilterChips() {
  const container = document.getElementById('filter-chip-group');
  container.innerHTML = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Ko\'nikma bo\'yicha filtrlash');
  MOCK_SKILLS.forEach(skill => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.skill = skill.id;
    chip.innerHTML = `${CHIP_CHECK_SVG}${skill.icon}<span>${skill.label}</span>`;
    const isSelected = searchFilterState.skills.includes(skill.id);
    if (isSelected) chip.classList.add('selected');
    chip.setAttribute('role', 'checkbox');
    chip.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    chip.tabIndex = 0;
    chip.onclick = () => toggleChip(chip, searchFilterState.skills, null);
    chip.onkeydown = (e) => handleCardKeydown(e);
    container.appendChild(chip);
  });

  // Filter sheet selector'larni ham reset ko'rinishida ko'rsatamiz
  setSelectorValue('filter-sel-viloyat', searchFilterState.region || 'Viloyatni tanlang', !!searchFilterState.region);
  setSelectorValue('filter-sel-tuman', searchFilterState.district || 'Tumanni tanlang', !!searchFilterState.district);
  setSelectorDisabled('filter-sel-tuman', !searchFilterState.region);
  updateSearchButtonBadge();
}

// 2.10 — "Qidirish (3)" tugmasidagi son. MANTIQ: har bir tanlangan
// skill chip + tanlangan viloyat + tanlangan tuman alohida-alohida
// "faol filtr" sifatida sanaladi (mahalla filter ekranida yo'q,
// shuning uchun hisobga kirmaydi). Son 0 bo'lsa qavs umuman
// ko'rsatilmaydi — "Qidirish (0)" chalkash ko'rinardi, tugma matni
// oddiy "Qidirish" holida qoladi. Xuddi shu hisob "Tozalash"
// havolasi va natija-preview matnining ko'rinish/yashirinishini
// ham boshqaradi — barchasi bir xil "faol filtr bormi" holatiga
// bog'liq, shuning uchun bitta funksiyada birlashtirilgan
// (alohida-alohida yozilsa har joyda bir xil hisob-kitob
// takrorlanardi).
function updateSearchButtonBadge() {
  const btn = document.getElementById('search-filters-btn');
  const resetLink = document.getElementById('filter-reset-link');
  const preview = document.getElementById('filter-preview-text');
  const count = searchFilterState.skills.length +
    (searchFilterState.region ? 1 : 0) +
    (searchFilterState.district ? 1 : 0);
  if (btn) btn.textContent = count > 0 ? `Qidirish (${count})` : 'Qidirish';
  if (resetLink) resetLink.classList.toggle('hidden', count === 0);
  // 2.10 — Natija preview: hech qanday filtr tanlanmagan bo'lsa
  // (count===0) barcha ishchilar mos keladi, bu holatda "hammasi
  // mos keladi" foydali emas — matn butunlay yashiriladi (bo'sh
  // ekranda bo'shliq ko'rinmasin uchun screen-fixed-bottom'da
  // min-height saqlanadi).
  if (preview) {
    if (count === 0) {
      preview.textContent = '';
    } else {
      const n = getFilteredWorkers().length;
      preview.textContent = n > 0 ? `~${n} ta ishchi topiladi` : 'Hozircha hech kim topilmaydi';
    }
  }
}

// 2.10 — Filtrni tozalash: skill chip'lar + viloyat/tuman'ni
// bekor qiladi va ekranni qayta chizadi (renderFilterChips()
// mavjud bir marta yozilgan render mantig'ini qayta ishlatadi,
// dublikat DOM-yangilash kodi yozilmagan).
function resetSearchFilters() {
  searchFilterState = { skills: [], region: null, district: null };
  renderFilterChips();
}

// ------------------------------------------------------------
// 12. QIDIRUV NATIJALARI
// MANTIQ: MOCK_WORKERS ustida filter — agar hech qanday filtr
// tanlanmagan bo'lsa, hammasi ko'rsatiladi (brief: "yoki oddiy
// demo uchun hammasini ko'rsatadi").
// ------------------------------------------------------------
let lastSearchResults = [];

// MANTIQ: real backend'da runSearch() aslida network so'rovi
// bo'ladi — demak natija DARHOL kelmaydi. Buni simulyatsiya qilish
// uchun sun'iy 600ms kechikish qo'shamiz va shu vaqt ichida
// skeleton ko'rsatamiz. Bu foydalanuvchini "productionda sekinroq
// bo'ladi" degan haqiqatga tayyorlaydi — hozirgi "hammasi
// bir zumda paydo bo'ladi" demo hissi yolg'on va yomon o'rgatadi.
const SEARCH_SIMULATED_DELAY = 600;

// Demo maqsadida: har 6-qidiruvdan 1 tasi xato holatini ko'rsatadi,
// shunda error-state ham ko'rinadi (aks holda hech kim uni
// ko'rmaydi, chunki mock data hech qachon "xato" bermaydi).
let searchAttemptCount = 0;

// 2.10: filter predicate runSearch() va natija-preview'da (pastda)
// ikkalasida ham kerak — bitta joyga chiqarildi, ikki marta
// yozilmasin.
function getFilteredWorkers() {
  return MOCK_WORKERS.filter(worker => {
    const skillMatch = searchFilterState.skills.length === 0 ||
      worker.skills.some(s => searchFilterState.skills.includes(s));
    const regionMatch = !searchFilterState.region || worker.region === searchFilterState.region;
    const districtMatch = !searchFilterState.district || worker.district === searchFilterState.district;
    return skillMatch && regionMatch && districtMatch;
  });
}

function runSearch() {
  go('search-results');
  const list = document.getElementById('results-list');
  renderWorkerCardSkeletons(list, 4);

  searchAttemptCount++;
  const shouldSimulateError = searchAttemptCount % 6 === 0;

  setTimeout(() => {
    if (currentScreen !== 'search-results') return; // foydalanuvchi allaqachon boshqa ekranga o'tgan bo'lsa, render qilmaymiz

    if (shouldSimulateError) {
      renderEmptyState(list, {
        variant: 'error',
        title: 'Qidiruvni bajarib bo\'lmadi',
        body: 'Internet aloqasi yoki serverda muammo bo\'lishi mumkin',
        onAction: () => runSearch()
      });
      return;
    }

    lastSearchResults = getFilteredWorkers();
    renderResults();
  }, SEARCH_SIMULATED_DELAY);
}

// ------------------------------------------------------------
// 2.11 SARALASH (Sort) — natijalar ro'yxatini rating/sharh soni
// bo'yicha qayta tartiblaydi. `openSheet()`dan ataylab ajratilgan:
// u yerdagi search-input/highlight mantig'i bu yerda kerak emas,
// bor-yo'g'i 3 ta statik variant. Vizual til bir xil (.sheet,
// .sheet-item, .sheet-item-check), lekin logika mustaqil.
// ------------------------------------------------------------
const SORT_OPTIONS = [
  { key: 'default', label: 'Standart (moslik bo\'yicha)' },
  { key: 'rating-desc', label: 'Reyting: yuqoridan pastga' },
  { key: 'reviews-desc', label: 'Sharhlar soni: ko\'pdan kamga' }
];
let currentSort = 'default';

function openSortSheet() {
  const list = document.getElementById('sort-sheet-list');
  list.innerHTML = '';
  list.setAttribute('role', 'listbox');
  SORT_OPTIONS.forEach(opt => {
    const row = document.createElement('div');
    const isSelected = opt.key === currentSort;
    row.className = 'sheet-item' + (isSelected ? ' is-selected' : '');
    row.innerHTML = `<span class="sheet-item-label">${opt.label}</span>${SHEET_CHECK_SVG}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    row.tabIndex = 0;
    row.onkeydown = (e) => handleCardKeydown(e);
    row.onclick = () => selectSort(opt.key);
    list.appendChild(row);
  });

  const sheet = document.getElementById('sort-sheet');
  sheet.classList.add('open');
  document.getElementById('sort-sheet-backdrop').classList.add('open');
}

function closeSortSheet() {
  document.getElementById('sort-sheet').classList.remove('open');
  document.getElementById('sort-sheet-backdrop').classList.remove('open');
}

function selectSort(key) {
  haptic.selection(); // 3.6: sort variantini tanlash — picker hissi
  currentSort = key;
  applySortToResults();
  renderResults();
  closeSortSheet();
}

function applySortToResults() {
  if (currentSort === 'rating-desc') {
    lastSearchResults = [...lastSearchResults].sort((a, b) => b.rating - a.rating);
  } else if (currentSort === 'reviews-desc') {
    lastSearchResults = [...lastSearchResults].sort((a, b) => b.reviewCount - a.reviewCount);
  }
  // 'default' — asl runSearch() tartibiga qaytarish uchun qayta filtrlaymiz
  // (getFilteredWorkers() MOCK_WORKERS asl ketma-ketligini saqlaydi)
  else {
    lastSearchResults = getFilteredWorkers();
  }
}

// 2.11 — List/Grid ko'rinishini almashtirish. `resultsViewMode`
// 'list' (default, .gap-12 — vertikal, to'liq eni) yoki 'grid'
// (.results-grid — 2 ustunli). Konteyner klassi almashtiriladi,
// karta markup'i o'zgarmaydi — kompaktlashtirish faqat CSS'da
// (.results-grid .worker-card ...).
let resultsViewMode = 'list';

const VIEW_ICON_GRID = '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>';
const VIEW_ICON_LIST = '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>';

function toggleResultsView() {
  resultsViewMode = resultsViewMode === 'list' ? 'grid' : 'list';
  renderResults();
}

function renderResults() {
  const list = document.getElementById('results-list');
  list.innerHTML = '';

  const toggleIcon = document.getElementById('view-toggle-icon');
  if (toggleIcon) {
    // Ikonka joriy rejimni emas, KEYINGI bosilganda nima bo'lishini
    // ko'rsatadi (odatiy toggle-tugma konvensiyasi).
    toggleIcon.innerHTML = resultsViewMode === 'list' ? VIEW_ICON_GRID : VIEW_ICON_LIST;
  }

  if (lastSearchResults.length === 0) {
    // Bo'sh holatda grid emas, har doim bitta ustunli — aks holda
    // xabar yarim enida g'alati ko'rinadi.
    list.classList.remove('results-grid');
    list.classList.add('gap-12');
    renderEmptyState(list, {
      icon: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
      title: 'Hali hech kim topilmadi',
      body: 'Filtrlarni biroz yumshating yoki boshqa mahallani sinab ko\'ring — yaxshi ustalar yaqinroqda bo\'lishi mumkin'
    });
    return;
  }

  list.classList.toggle('results-grid', resultsViewMode === 'grid');
  list.classList.toggle('gap-12', resultsViewMode === 'list');

  lastSearchResults.forEach((worker, index) => {
    const card = document.createElement('div');
    card.className = 'worker-card';
    card.style.setProperty('--stagger-index', index);
    // A11y: qidiruv natijalari — asosiy oqim, worker-feed-card bilan bir xil qoida.
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${worker.name}, ${worker.mahalla}, reyting ${worker.rating.toFixed(1)}`);
    card.onclick = () => openWorkerDetailFromList(worker);
    card.onkeydown = (e) => handleCardKeydown(e);
    card.innerHTML = `
      <div class="worker-card-top">
        ${renderAvatar(worker, 'avatar-photo--sm')}
        <div class="gap-4">
          <div class="worker-card-name">${worker.name}</div>
          <div class="worker-card-mahalla">${worker.mahalla}</div>
        </div>
      </div>
      ${renderRatingBadge(worker)}
      <div class="worker-card-skills">
        ${worker.skills.map(s => `<span class="skill-chip">${s}</span>`).join('')}
      </div>
    `;
    list.appendChild(card);
  });
}

// ------------------------------------------------------------
// 13. ISHCHI PROFILI (detail)
// MANTIQ: bu funksiya endi worker OBYEKTINI to'g'ridan-to'g'ri
// qabul qiladi (indeks emas) — chunki detail endi ikki xil manbadan
// ochilishi mumkin: qidiruv natijalaridan (lastSearchResults) YOKI
// home feed'idan (MOCK_WORKERS). Ikkalasi ham shu bitta funksiyaga
// keladi, ortiqcha dublikat kod yo'q.
// ------------------------------------------------------------
// ------------------------------------------------------------
// SAQLANGAN (Favorites) — ro'yxat render (2.14)
// MANTIQ: bu employer'ning "Saqlangan" tab'i — MOCK_WORKERS ichidan
// appState.favorites (phone-massiv)ga mos kelganlarini filtrlaydi.
// Karta markup'i renderResults()dagi bilan BIR XIL (.worker-card,
// renderAvatar, renderRatingBadge, skill-chip'lar) — bu "saqlangan
// ishchi" va "qidiruv natijasidagi ishchi" foydalanuvchi uchun bir
// xil narsa, faqat manba boshqa, shuning uchun vizual til ham bir
// xil bo'lishi kerak. Network kechikishi yo'q (runSearch()dagi kabi)
// — favorites doim local state, hech qanday "so'rov" simulyatsiya
// qilinmaydi.
// ------------------------------------------------------------
async function renderFavorites() {
  const list = document.getElementById('favorites-list');
  if (!list) return;

  let favoriteWorkers = MOCK_WORKERS.filter(w => appState.favorites.includes(w.id));

  // Backend haqiqiy manba — mavjud bo'lsa undan yangilangan ro'yxatni
  // olamiz (boshqa qurilma/sessiyada qo'shilgan o'zgarishlar ham
  // ko'rinishi uchun). Xatolik bo'lsa — yuqoridagi local hisob bilan
  // davom etamiz (ilova sinmaydi).
  if (appState.id) {
    try {
      favoriteWorkers = await ChaqirAPI.getFavorites(appState.id);
      appState.favorites = favoriteWorkers.map(w => w.id);
      if (currentScreen !== 'favorites') return; // shu orada boshqa ekranga o'tib ketilgan
    } catch (e) {
      console.error('Sevimlilarni yuklashda xatolik:', e);
    }
  }

  if (favoriteWorkers.length === 0) {
    list.classList.remove('results-grid');
    list.classList.add('gap-12');
    renderEmptyState(list, {
      icon: ICON_HEART,
      title: 'Hali sevimlilar yo\'q',
      body: 'Yoqtirgan ishchingizni yurakcha bilan saqlang — keyin tezroq topasiz'
    });
    return;
  }

  list.innerHTML = '';
  favoriteWorkers.forEach((worker, index) => {
    const card = document.createElement('div');
    // 2.14 — .worker-card--favorite faqat shu karta uchun position:
    // relative + o'ng tomonga joy beradi (asosiy .worker-card CSS'i
    // boshqa 3 joyda ham ishlatilgani uchun bevosita o'zgartirilmaydi
    // — modifier-class orqali faqat shu ekranda kerakli joy ochiladi).
    card.className = 'worker-card worker-card--favorite';
    card.style.setProperty('--stagger-index', index);
    // A11y: bu yerda ichida ikkita interaktiv narsa bor — karta o'zi (detail'ga
    // olib boradi) va "o'chirish" tugmasi. Ikkalasi ham alohida fokus va label
    // olishi kerak, aks holda screen-reader "tugma ichida tugma" holatini
    // to'g'ri e'lon qila olmaydi.
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${worker.name}, ${worker.mahalla}, reyting ${worker.rating.toFixed(1)}`);
    card.onclick = () => openWorkerDetailFromList(worker);
    card.onkeydown = (e) => handleCardKeydown(e);
    card.innerHTML = `
      <button class="favorite-remove-btn" aria-label="Saqlangandan olib tashlash">${ICON_TRASH}</button>
      <div class="worker-card-top">
        ${renderAvatar(worker, 'avatar-photo--sm')}
        <div class="gap-4">
          <div class="worker-card-name">${worker.name}</div>
          <div class="worker-card-mahalla">${worker.mahalla}</div>
        </div>
      </div>
      ${renderRatingBadge(worker)}
      <div class="worker-card-skills">
        ${worker.skills.map(s => `<span class="skill-chip">${s}</span>`).join('')}
      </div>
    `;
    // MANTIQ: tugma karta ichida, lekin kartaning o'z onclick'i
    // (detail'ga o'tish) bilan TO'QNASHADI — shuning uchun
    // stopPropagation() shart, aks holda "olib tashlash" bosilganda
    // ham profil ochilib ketardi. worker.onclick'ni o'rnatishdan
    // KEYIN qo'shilyapti, chunki innerHTML query'dan oldin element
    // DOM'da hali yo'q.
    card.querySelector('.favorite-remove-btn').onclick = (e) => {
      e.stopPropagation();
      toggleFavorite(worker);
    };
    list.appendChild(card);
  });
}

// ------------------------------------------------------------
// SAQLANGAN (Favorites) — toggle mantig'i
// MANTIQ: worker.phone unique key sifatida ishlatiladi (ism
// takrorlanishi mumkin, telefon raqam mumkin emas). Faqat
// employer roli uchun mazmunli — worker o'zini saqlamaydi, lekin
// himoya sifatida funksiya har doim xavfsiz ishlaydi.
// ------------------------------------------------------------
function isFavorite(worker) {
  return appState.favorites.includes(worker.id);
}

function toggleFavorite(worker) {
  // 8.1 — Optimistic UI: UI darhol o'zgaradi, toast "tasdiqlash"
  // sifatida keyinroq chiqadi. Backend'ga POST/DELETE fon rejimida
  // yuboriladi; xato bo'lsa — local state orqaga qaytariladi.
  haptic.light();
  const idx = appState.favorites.indexOf(worker.id);
  const adding = idx === -1;
  if (adding) {
    appState.favorites.push(worker.id);
  } else {
    appState.favorites.splice(idx, 1);
  }

  // Darhol vizual yangilanish (optimistic)
  if (currentScreen === 'worker-detail') {
    updateFavoriteButton(worker, true);
  }
  if (currentScreen === 'favorites') renderFavorites();
  if (currentScreen === 'search-results') renderResults();

  const name = worker.name;

  if (!appState.id) {
    // employer id yo'q (mock login orqali kirilgan) — faqat local UI,
    // backend'ga yozib bo'lmaydi.
    setTimeout(() => {
      if (adding) showToast(`${name} saqlandi`, 'success');
      else showToast(`${name} saqlangandan olib tashlandi`, 'info');
    }, 180);
    return;
  }

  const apiCall = adding
    ? ChaqirAPI.addFavorite(appState.id, worker.id)
    : ChaqirAPI.removeFavorite(appState.id, worker.id);

  apiCall.then(() => {
    if (adding) showToast(`${name} saqlandi`, 'success');
    else showToast(`${name} saqlangandan olib tashlandi`, 'info');
  }).catch((e) => {
    console.error('Sevimlilarni yangilashda xatolik:', e);
    // Rollback
    const idx2 = appState.favorites.indexOf(worker.id);
    if (adding && idx2 !== -1) appState.favorites.splice(idx2, 1);
    if (!adding && idx2 === -1) appState.favorites.push(worker.id);
    if (currentScreen === 'worker-detail') updateFavoriteButton(worker, true);
    if (currentScreen === 'favorites') renderFavorites();
    if (currentScreen === 'search-results') renderResults();
    showToast('Server bilan bog\'lanishda xatolik', 'error');
  });
}

function updateFavoriteButton(worker, animate) {
  const btn = document.getElementById('worker-favorite-btn');
  if (!btn) return;
  const active = isFavorite(worker);
  btn.classList.toggle('is-active', active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  if (animate) {
    btn.classList.remove('is-optimistic-pop');
    // reflow — animatsiyani qayta ishga tushirish
    void btn.offsetWidth;
    btn.classList.add('is-optimistic-pop');
  }
}

let currentDetailWorker = null;
let currentChatConversation = null; // 2.15 — chat-detail ekrani hozir qaysi suhbatni ochganini bildiradi

function openWorkerDetailFromList(worker) {
  currentDetailWorker = worker;
  openWorkerDetail();
}

// TODO(backend): worker.name/mahalla/address kabi maydonlar hozir
// MOCK_WORKERS'dan (bizning o'z static data'miz) — xavfsiz. Backend
// ulanganda bular boshqa foydalanuvchi kiritgan real matn bo'ladi,
// shu payt openWorkerDetail/renderResults/renderHomeFeed ichidagi
// innerHTML shablonlariga escapeHtml() qo'llash SHART, aks holda
// bitta ishchi profilidagi "ism"i orqali XSS kiritish mumkin bo'ladi.
function openWorkerDetail() {
  const worker = currentDetailWorker;
  const content = document.getElementById('worker-detail-content');

  // HIMOYA: agar bu ekranga worker tanlanmasdan kelib qolinsa
  // (masalan kelajakda Favorites'dan to'g'ridan-to'g'ri chaqirilsa,
  // yoki brauzer holatini qayta tiklashda) — crash o'rniga error-state.
  if (!worker) {
    renderEmptyState(content, {
      variant: 'error',
      title: 'Profilni topib bo\'lmadi',
      body: 'Ma\'lumot yuklanmadi. Birozdan keyin yana urinib ko\'ring',
      actionLabel: 'Orqaga',
      onAction: () => goBack()
    });
    document.getElementById('worker-call-btn').style.display = 'none';
    document.getElementById('worker-message-btn').style.display = 'none';
    document.getElementById('worker-order-btn').style.display = 'none';
    go('worker-detail');
    return;
  }
  document.getElementById('worker-call-btn').style.display = '';
  document.getElementById('worker-message-btn').style.display = '';

  content.innerHTML = `
    <div class="worker-detail-header">
      ${renderAvatar(worker, 'avatar-photo--lg')}
      <button class="favorite-btn${isFavorite(worker) ? ' is-active' : ''}" id="worker-favorite-btn" aria-label="Saqlash" aria-pressed="${isFavorite(worker)}">${ICON_HEART}</button>
    </div>
    <div class="h1" style="text-align:center;">${worker.name}</div>
    <div style="display:flex; justify-content:center;">${renderRatingBadge(worker)}</div>
    <div class="worker-card-skills" style="justify-content:center;">
      ${worker.skills.map(s => `<span class="skill-chip">${s}</span>`).join('')}
    </div>
    <div class="detail-row">
      <div class="detail-row-label">HUDUD</div>
      <div class="detail-row-value">${worker.region}, ${worker.district}, ${worker.mahalla}</div>
    </div>
    ${worker.address ? `
    <div class="detail-row">
      <div class="detail-row-label">MANZIL</div>
      <div class="detail-row-value">${worker.address}</div>
    </div>` : ''}
    <div class="detail-row">
      <div class="detail-row-label">TELEFON</div>
      <div class="detail-row-value detail-row-value--numeric">${worker.phone}</div>
    </div>
    ${renderPortfolioSection(worker)}
    ${renderReviewsSection(worker)}
  `;
  document.getElementById('worker-call-btn').onclick = () => callWorker(worker);
  document.getElementById('worker-message-btn').onclick = () => messageWorker(worker);
  document.getElementById('worker-favorite-btn').onclick = () => toggleFavorite(worker);

  // "So'rov yuborish" faqat employer uchun mantiqiy — worker o'ziga yoki
  // boshqa workerga buyurtma bermaydi.
  const orderBtn = document.getElementById('worker-order-btn');
  orderBtn.style.display = appState.role === 'employer' ? '' : 'none';
  orderBtn.onclick = () => openOrderSheet(worker);
  go('worker-detail');
}

// ------------------------------------------------------------
// PORTFOLIO / RASM GALEREYASI — 2.12 roadmap punkti ("UI joy
// ajratish"). MANTIQ: xuddi renderReviewsSection() bilan bir xil
// pattern — worker.portfolio hali mock data'da yo'q (backend
// ulanmagan), shuning uchun hozircha har doim bo'sh holat
// ko'rsatiladi, lekin struktura (label qatori + grid konteyner)
// backend'dan rasm massivi kelganda to'ldirilishga tayyor.
// XAVFSIZLIK: kelajakda rasm URL'lari backend'dan kelganda <img
// src> escapeHtml() talab qilmaydi (atribut, HTML emas), lekin
// alt/caption matni kelsa escapeHtml() qo'llanishi kerak (pastda
// qo'llanilgan).
// ------------------------------------------------------------
// ------------------------------------------------------------
// 8.3 — Image lazy-load + placeholder pattern
// Umumiy helper: shimmer placeholder → img loading=lazy → fade-in.
// Portfolio, kelajakdagi galereya va boshqa joylarda qayta ishlatiladi.
// ------------------------------------------------------------
function renderLazyImage(url, { alt = '', className = 'lazy-img', aspect = '1/1' } = {}) {
  const safeAlt = escapeHtml(alt);
  // URL atribut sifatida — escapeHtml HTML entity qiladi, URL uchun
  // faqat " va < ni tozalash yetarli (mock/backend HTTPS URL).
  const safeUrl = String(url || '').replace(/"/g, '%22').replace(/</g, '');
  return `
    <div class="img-placeholder ${className}" style="aspect-ratio:${aspect}">
      <div class="img-placeholder-shimmer" aria-hidden="true"></div>
      <img src="${safeUrl}" alt="${safeAlt}" loading="lazy" decoding="async"
        onload="this.parentElement.classList.add('is-loaded')"
        onerror="this.parentElement.classList.add('is-error'); this.remove();">
    </div>`;
}

function renderPortfolioSection(worker) {
  const photos = worker.portfolio || [];

  if (photos.length === 0) {
    return `
      <div class="detail-row">
        <div class="detail-row-label">RASMLAR</div>
      </div>
      <div class="empty-state empty-state--compact">
        <div class="body">Hali ish namunalari yo'q — tez orada qo'shiladi</div>
      </div>`;
  }

  const thumbs = photos.map(p =>
    `<div class="portfolio-thumb" role="img" aria-label="${escapeHtml(p.caption || '')}">
      ${renderLazyImage(p.url, { alt: p.caption || '', className: 'lazy-img portfolio-thumb-img' })}
    </div>`
  ).join('');

  return `
    <div class="detail-row">
      <div class="detail-row-label">RASMLAR (${photos.length})</div>
    </div>
    <div class="portfolio-grid">${thumbs}</div>`;
}

// ------------------------------------------------------------
// SHARHLAR (Reviews) — 2.12 roadmap punkti
// MANTIQ: har bir sharh kartasi — muallif ismi, yulduzcha reytingi
// va matn. worker.reviews bo'lmasa (masalan yangi ro'yxatdan o'tgan
// ishchi) — bo'sh holat ko'rsatiladi, roadmap talab qilganidek
// "hozir umuman yo'q" o'rniga endi tizimli.
// XAVFSIZLIK: author/text escapeHtml() orqali o'tadi, chunki bular
// backend ulanganda REAL foydalanuvchi kiritgan matn bo'ladi.
// ------------------------------------------------------------
function renderReviewsSection(worker) {
  const reviews = worker.reviews || [];
  const starSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

  if (reviews.length === 0) {
    return `
      <div class="detail-row">
        <div class="detail-row-label">SHARHLAR</div>
      </div>
      <div class="empty-state empty-state--compact">
        <div class="body">Hali sharh yo'q — birinchilardan bo'ling!</div>
      </div>`;
  }

  const cards = reviews.map(r => {
    const safeAuthor = escapeHtml(r.author);
    const safeText = escapeHtml(r.text);
    const clampedRating = Math.max(1, Math.min(5, Math.round(r.rating)));
    const stars = Array.from({ length: 5 }, (_, i) =>
      `<span class="review-star${i < clampedRating ? ' is-filled' : ''}">${starSvg}</span>`
    ).join('');
    return `
      <div class="review-card">
        <div class="review-card-top">
          <span class="review-card-author">${safeAuthor}</span>
          <span class="review-card-stars">${stars}</span>
        </div>
        <div class="review-card-text">${safeText}</div>
      </div>`;
  }).join('');

  return `
    <div class="detail-row">
      <div class="detail-row-label">SHARHLAR (${reviews.length})</div>
    </div>
    <div class="reviews-list">${cards}</div>`;
}

function callWorker(worker) {
  // MOCK: real qo'ng'iroq yo'q, faqat demo signal.
  // Ilgari bu alert() edi — SPA oqimini to'xtatib qo'yardi va
  // "web 1.0" hissi berardi. Endi toast — non-blocking, o'zi ketadi.
  showToast(`Qo'ng'iroq: ${worker.name} — ${worker.phone}`, 'success');
}

// 2.12 — "Bog'lanish" tugmalarini kengaytirish: xabar yozish UI'si.
// MANTIQ: employer worker bilan suhbat boshlaydi — POST /api/conversations
// orqali (agar ular orasida allaqachon suhbat bo'lsa, backend o'shani
// qaytaradi, yangisi yaratilmaydi). Muvaffaqiyatli bo'lsa to'g'ridan-to'g'ri
// chat oynasi ochiladi.
async function messageWorker(worker) {
  if (!appState.id || !appState.token) {
    showToast('Xabar yozish uchun ro\'yxatdan o\'ting', 'info');
    return;
  }
  try {
    // Backend token egasini user_a qilib oladi — faqat worker id yuboriladi.
    const { id } = await ChaqirAPI.createConversation(worker.id);
    await refreshConversations(); // MOCK_CONVERSATIONS'ni yangilaydi
    const conv = MOCK_CONVERSATIONS.find(c => c.id === id);
    if (conv) {
      currentChatConversation = conv;
      go('chat-detail');
    } else {
      // Yangi suhbat hali refresh ro'yxatida bo'lmasa ham ochishga urinish
      currentChatConversation = {
        id,
        contactName: worker.name,
        contactId: worker.id,
        avatarColor: worker.avatarColor || worker.avatar_color || '#3B82F6',
        unreadCount: 0,
        messages: []
      };
      go('chat-detail');
    }
  } catch (e) {
    console.error('Suhbat ochishda xatolik:', e);
    showToast('Suhbat ochilmadi, qayta urinib ko\'ring', 'error');
  }
}

// ------------------------------------------------------------
// 3.3 — Employer → worker so'rov (buyurtma) yuborish bottom-sheet
// MANTIQ: worker-detail dagi "So'rov yuborish" tugmasi ochadi.
// Ko'nikma (worker.skills dan), mahalla (appState.mahalla default)
// tanlanadi va POST /api/orders ga yuboriladi. client_name backend
// token egasidan olinadi — frontend soxta ism yubormaydi.
// ------------------------------------------------------------
let pendingOrderWorker = null;
let pendingOrderSkill = null;

function openOrderSheet(worker) {
  if (!appState.id || appState.role !== 'employer') {
    showToast('So\'rov yuborish uchun ish qidiruvchi sifatida kiring', 'info');
    return;
  }
  pendingOrderWorker = worker;
  pendingOrderSkill = null;

  document.getElementById('order-sheet-worker-name').textContent =
    worker.name ? `${worker.name} ga so'rov` : 'So\'rov yuborish';

  const skillsEl = document.getElementById('order-sheet-skills');
  skillsEl.innerHTML = '';
  const skills = (worker.skills && worker.skills.length) ? worker.skills : [];

  if (skills.length === 0) {
    skillsEl.innerHTML = '<div class="body" style="margin-bottom:8px;">Ko\'nikma ko\'rsatilmagan</div>';
  } else if (skills.length === 1) {
    pendingOrderSkill = skills[0];
    skillsEl.innerHTML = `<div class="body" style="margin-bottom:8px;">Ko'nikma: <strong>${escapeHtml(skills[0])}</strong></div>`;
  } else {
    const label = document.createElement('div');
    label.className = 'body';
    label.style.marginBottom = '8px';
    label.textContent = 'Ko\'nikmani tanlang:';
    skillsEl.appendChild(label);

    const chipGroup = document.createElement('div');
    chipGroup.className = 'chip-group';
    chipGroup.style.marginBottom = '12px';
    skills.forEach((skill, idx) => {
      const chip = document.createElement('div');
      chip.className = 'chip' + (idx === 0 ? ' selected' : '');
      chip.textContent = skill;
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', idx === 0 ? 'true' : 'false');
      chip.tabIndex = 0;
      if (idx === 0) pendingOrderSkill = skill;
      chip.onclick = () => {
        chipGroup.querySelectorAll('.chip').forEach(c => {
          c.classList.remove('selected');
          c.setAttribute('aria-checked', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-checked', 'true');
        pendingOrderSkill = skill;
        haptic.selection();
      };
      chip.onkeydown = (e) => handleCardKeydown(e);
      chipGroup.appendChild(chip);
    });
    skillsEl.appendChild(chipGroup);
  }

  const mahallaField = document.getElementById('order-mahalla-field');
  mahallaField.value = appState.mahalla || '';
  clearFieldError('field-order-mahalla');

  const sheet = document.getElementById('order-sheet');
  sheet.classList.add('open');
  document.getElementById('order-sheet-backdrop').classList.add('open');
}

function closeOrderSheet() {
  document.getElementById('order-sheet').classList.remove('open');
  document.getElementById('order-sheet-backdrop').classList.remove('open');
  pendingOrderWorker = null;
  pendingOrderSkill = null;
}

async function submitOrderRequest() {
  if (!pendingOrderWorker) return;

  const mahalla = document.getElementById('order-mahalla-field').value.trim();
  if (!mahalla) {
    setFieldError('field-order-mahalla');
    showToast('Mahallani kiriting', 'error');
    return;
  }
  if (!pendingOrderSkill) {
    showToast('Ko\'nikmani tanlang', 'error');
    return;
  }

  const btn = document.getElementById('order-submit-btn');
  if (btn) btn.classList.add('is-disabled');

  try {
    await ChaqirAPI.createOrder({
      worker_id: pendingOrderWorker.id,
      skill: pendingOrderSkill,
      mahalla
    });
    showToast('So\'rovingiz yuborildi!', 'success');
    haptic.success();
    closeOrderSheet();
    goBack();
  } catch (e) {
    console.error('So\'rov yuborishda xatolik:', e);
    showToast(e.message || 'So\'rov yuborilmadi, qayta urinib ko\'ring', 'error');
    haptic.error();
  } finally {
    if (btn) btn.classList.remove('is-disabled');
  }
}

// ------------------------------------------------------------
// 2.15 XABARLAR (Messages) — suhbatlar ro'yxati
// MANTIQ: MOCK_CONVERSATIONS ustida ishlaydi, screen-content
// avvaldan skeleton/empty-state pattern'iga ega (Bo'lim 4), shuning
// uchun bo'sh holat uchun renderEmptyState() qayta ishlatiladi —
// yangi bo'sh-holat UI o'ylab topilmaydi.
// ------------------------------------------------------------
async function renderMessages() {
  const list = document.getElementById('messages-list');
  if (!list) return;

  await refreshConversations(); // backend'dan GET /api/conversations?user_id=...
  if (currentScreen !== 'messages') return;

  if (!MOCK_CONVERSATIONS || MOCK_CONVERSATIONS.length === 0) {
    renderEmptyState(list, {
      icon: ICON_MESSAGES,
      title: 'Hali xabarlar yo\'q',
      body: 'Mijozlar yozganda suhbatlar shu yerda paydo bo\'ladi — birinchi xabar kutilmoqda'
    });
    return;
  }

  list.innerHTML = '';
  MOCK_CONVERSATIONS.forEach(conv => {
    const lastMsg = conv.messages[conv.messages.length - 1];
    const hasUnread = conv.unreadCount > 0;
    const item = document.createElement('div');
    item.className = `conversation-item${hasUnread ? ' has-unread' : ''}`;
    // A11y: suhbatlar ro'yxati — Messages ekranining asosiy interaktiv qismi.
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.setAttribute('aria-label', `${conv.contactName}${hasUnread ? `, ${conv.unreadCount} ta o'qilmagan xabar` : ''}, oxirgi xabar: ${lastMsg.text}`);
    item.onclick = () => openChat(conv.id);
    item.onkeydown = (e) => handleCardKeydown(e);
    item.innerHTML = `
      ${renderAvatar({ name: conv.contactName, avatarColor: conv.avatarColor }, 'avatar-photo--sm')}
      <div class="conversation-item-body">
        <div class="conversation-item-top">
          <span class="conversation-item-name">${escapeHtml(conv.contactName)}</span>
          <span class="conversation-item-time">${escapeHtml(lastMsg.time)}</span>
        </div>
        <div class="conversation-item-preview">${escapeHtml(lastMsg.text)}</div>
      </div>
      ${hasUnread ? `<span class="conversation-unread-badge">${conv.unreadCount}</span>` : ''}
    `;
    list.appendChild(item);
  });
}

// ------------------------------------------------------------
// 2.15 CHAT OYNASI
// MANTIQ: openWorkerDetailFromList bilan bir xil pattern — global
// "hozir qaysi obyekt ochilgan" o'zgaruvchisi (currentChatConversation)
// + go(). Xabar yuborish REAL vaqtda appState emas, MOCK_CONVERSATIONS
// massiviga to'g'ridan-to'g'ri yoziladi (sessiya davomida saqlanadi,
// backend ulanganda bu yerga POST /api/messages keladi). Kontakt
// ismi/matni backend'dan kelganda o'zgarishi mumkin bo'lgan matn
// sifatida qaraladi — escapeHtml() SHART (Bo'lim 4 izohi bilan bir xil
// qoida).
// ------------------------------------------------------------
function openChat(conversationId) {
  const conv = MOCK_CONVERSATIONS.find(c => c.id === conversationId);
  if (!conv) return;
  currentChatConversation = conv;
  conv.unreadCount = 0; // UI darhol yangilanadi
  go('chat-detail');
  // Backendga ham o'qilgan deb yozamiz (keyingi refresh'da badge yo'qoladi)
  if (appState.token) {
    ChaqirAPI.markConversationRead(conversationId).catch(() => {});
  }
}

function renderChat() {
  const conv = currentChatConversation;
  const nameEl = document.getElementById('chat-contact-name');
  const list = document.getElementById('chat-messages');
  if (!conv || !nameEl || !list) return;

  nameEl.textContent = conv.contactName;
  list.innerHTML = conv.messages.map(msg => `
    <div class="chat-bubble-row${msg.from === 'me' ? ' is-me' : ''}${msg.pending ? ' is-pending' : ''}">
      <div class="chat-bubble">
        ${escapeHtml(msg.text)}
        <span class="chat-bubble-time">${msg.pending ? 'Yuborilmoqda…' : escapeHtml(msg.time)}</span>
      </div>
    </div>
  `).join('');
  list.scrollTop = list.scrollHeight; // eng oxirgi xabarga scroll
}

function sendChatMessage() {
  // 8.1 — Optimistic UI: xabar darhol ro'yxatda paydo bo'ladi
  // (is-pending), keyin backend tasdiqlagach (POST
  // /api/conversations/:id/messages) "yuborildi" holatiga o'tadi.
  // Xato bo'lsa — bubble ro'yxatdan olib tashlanadi + error toast.
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !currentChatConversation) return;

  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const msg = { from: 'me', text, time, pending: true };
  currentChatConversation.messages.push(msg);
  input.value = '';
  haptic.light();
  renderChat();

  if (!appState.id) {
    // id yo'q (mock login) — backend'ga yozib bo'lmaydi, faqat local
    setTimeout(() => { msg.pending = false; if (currentScreen === 'chat-detail') renderChat(); }, 400);
    return;
  }

  ChaqirAPI.sendMessage(currentChatConversation.id, text)
    .then(() => {
      msg.pending = false;
      if (currentScreen === 'chat-detail' && currentChatConversation) renderChat();
    })
    .catch((e) => {
      console.error('Xabar yuborishda xatolik:', e);
      const idx = currentChatConversation.messages.indexOf(msg);
      if (idx !== -1) currentChatConversation.messages.splice(idx, 1);
      if (currentScreen === 'chat-detail') renderChat();
      showToast('Xabar yuborilmadi — qayta urinib ko\'ring', 'error');
    });
}

// ------------------------------------------------------------
// 14. MENING PROFILIM
// ------------------------------------------------------------
// ------------------------------------------------------------
// TUNGI REJIM (DARK MODE)
// MANTIQ: haqiqiy holat manbai <html data-theme="..."> atributi.
// - Agar foydalanuvchi hech qachon tugmani bosmagan bo'lsa, atribut
//   umuman qo'yilmaydi — CSS'dagi @media(prefers-color-scheme:dark)
//   o'zi ishlaydi (tizim sozlamasiga ergashadi).
// - Tugma bosilganda ANIQ tanlov localStorage'ga yoziladi va shu
//   paytdan boshlab tizim sozlamasidan qat'iy nazar shu qo'llanadi.
// getEffectiveTheme() ikkalasini ham hisobga olib profil ekranidagi
// svitcherni to'g'ri holatda chizish uchun ishlatiladi.
// ------------------------------------------------------------
function getEffectiveTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function toggleTheme() {
  haptic.light(); // 3.6: switch bosish — kichik harakat
  const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('chaqir-theme', next); } catch (e) { /* localStorage yo'q bo'lsa ham UI ishlayveradi, faqat reload'da eslab qolmaydi */ }
  if (currentScreen === 'profile') renderProfile();
}

// 2.13 — Profilni tahrirlash tugmasi UI'si. MANTIQ: to'liq
// tahrirlash formasi (input maydonlari, saqlash) alohida roadmap
// bandi emas — bu band faqat tugma UI'sini talab qiladi.
// `messageWorker()`/`callWorker()` bilan bir xil MOCK-toast
// pattern qo'llanildi — yangi, izchil bo'lmagan flow o'ylab
// topmadim.
function editProfile() {
  showToast('Profilni tahrirlash (tez orada)', 'info');
}

const PROFILE_ROW_ICONS = {
  'Ism': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  'Rol': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  "Ko'nikmalar": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  'Hudud': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  'Manzil': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  'Telefon': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
};

function renderProfile() {
  const content = document.getElementById('profile-content');
  const rows = [
    ['Ism', appState.name || '—'],
    ['Rol', appState.role === 'worker' ? 'Ishchi' : 'Ish qidiruvchi'],
  ];
  if (appState.role === 'worker' && appState.skills.length > 0) {
    rows.push(['Ko\'nikmalar', appState.skills.join(', ')]);
  }
  if (appState.region) rows.push(['Hudud', `${appState.region}, ${appState.district || ''}, ${appState.mahalla || ''}`]);
  if (appState.address) rows.push(['Manzil', appState.address]);
  if (appState.phone) rows.push(['Telefon', appState.phone]);

  // 2.13 — Statistika bloki. MANTIQ: bu ko'rsatkichlar (profil necha marta
  // ko'rilgan, nechta baho olingan) faqat SERVER tomonda hisoblanadigan
  // agregatsiya — biz uchun hali backend yo'q. Faqat 'worker' uchun
  // mazmunli (employer'ni hech kim qidirib "ko'rmaydi"/baholamaydi, u
  // qidiruvchi tomonda), shuning uchun skills-row bilan bir xil rol-shart
  // ishlatiladi. Sonlar vaqtinchalik mock — backend ulanganda shu ikki
  // qiymat appState.profileViews / appState.ratingCount kabi haqiqiy
  // maydonlarga almashtiriladi, HTML/CSS o'zgarmaydi.
  const statsCard = appState.role === 'worker' ? `
    <div class="profile-stats-grid">
      <div class="profile-stat-card">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <div class="profile-stat-value">47</div>
        <div class="profile-stat-label">Marta ko'rilgan</div>
      </div>
      <div class="profile-stat-card">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>
        <div class="profile-stat-value">12</div>
        <div class="profile-stat-label">Baho olingan</div>
      </div>
    </div>
  ` : '';

  const isDark = getEffectiveTheme() === 'dark';
  const themeRow = `
    <div class="profile-theme-row">
      <span class="profile-theme-row-label">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        Tungi rejim
      </span>
      <button class="switch ${isDark ? 'is-on' : ''}" onclick="toggleTheme()" aria-label="Tungi rejimni yoqish/o'chirish" aria-pressed="${isDark}">
        <span class="switch-thumb"></span>
      </button>
    </div>
  `;

  // XAVFSIZLIK TUZATISHI (hard-diagnostic audit): 'Ism' va 'Manzil' qatorlari
  // appState.name / appState.address'dan keladi — bular ERKIN MATN input
  // maydonlaridan to'g'ridan-to'g'ri kelgan foydalanuvchi qiymatlari (hech
  // qanday tanlov-ro'yxatidan emas, xohlagan HTML/skript kiritish mumkin).
  // Loyihada xuddi shu xavf uchun chat/review matnlarida escapeHtml() allaqachon
  // ishlatilgan edi, lekin bu yerga qo'llanilmagan edi — innerHTML'ga xom holda
  // tushardi (o'z-o'ziga XSS). Endi barcha qatorlar (hatto xavfsiz manbalilar —
  // Rol/Hudud/Telefon fixed ro'yxat yoki raqamdan keladi) bir xilda escapeHtml()
  // orqali o'tadi — defense-in-depth, xavfsiz qiymatga ham zarar keltirmaydi.
  content.innerHTML = statsCard + themeRow + rows.map(([label, value]) => `
    <div class="profile-row">
      <span class="profile-row-label">${PROFILE_ROW_ICONS[label] || ''}${label}</span>
      <span class="profile-row-value${label === 'Telefon' ? ' profile-row-value--numeric' : ''}">${escapeHtml(String(value))}</span>
    </div>
  `).join('');
}

// ============================================================
// BO'LIM 4: LOADING / EMPTY / ERROR — SISTEMIK KOMPONENTLAR
// MANTIQ: bu blok butun ilova bo'ylab qayta ishlatiladigan 3 ta
// primitivni beradi — toast, skeleton, va empty/error state.
// Screen-specific kod (masalan renderResults) shu funksiyalarni
// chaqiradi, o'zi HTML yozmaydi. Backend ulanganda ham bu qatlam
// o'zgarmaydi — faqat uni chaqiradigan joylar ko'payadi.
// ============================================================

// ------------------------------------------------------------
// ESCAPE HELPER
// MANTIQ: hozircha showToast/renderEmptyState'ga faqat bizning
// hardcoded matnlarimiz kelyapti — xavfsiz. Lekin backend ulanganda
// bu funksiyalarga birinchi bo'lib SERVER error message yoki
// USER-generated matn (masalan chat xabari, ism) kelib qoladi.
// innerHTML orqali xom holda qo'yilsa — XSS eshigi ochiladi
// (masalan message.body = "<img src=x onerror=alert(1)>").
// Shuning uchun har qanday DINAMIK, tashqi manbadan kelishi mumkin
// bo'lgan matn shu funksiya orqali o'tkaziladi.
// ------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

// ------------------------------------------------------------
// TOAST / SNACKBAR
// alert() o'rniga ishlatiladi. 3 turi bor: success, error, info.
// Vizual model: xabar pastdan suzib chiqadi, bir necha soniyadan
// so'ng o'zi pastga suzib yo'qoladi — foydalanuvchi hech narsa
// bosishi shart emas, oqim to'xtamaydi.
// ------------------------------------------------------------
// ------------------------------------------------------------
// 1.3 — ICON SET (error / warning / success / info)
// Yagona manba: toast, empty-state, form xatolari va boshqa
// joylarda shu konstantalardan foydalaniladi. Stroke-width
// qoidasiga mos (18px → 2.2-2.4).
// ------------------------------------------------------------
const ICONS = {
  success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  error:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>',
  warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  info:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><path d="M12 8h.01"/></svg>'
};

// Orqa-moslashuv: eski TOAST_ICONS nomini saqlab qolamiz
const TOAST_ICONS = ICONS;

/** Spinner HTML string (CSS .spinner klassiga tayanadi) */
function spinnerHtml(size = 'md') {
  const cls = size === 'sm' ? 'spinner spinner-sm'
            : size === 'lg' ? 'spinner spinner-lg'
            : 'spinner spinner-md';
  return `<span class="${cls}" aria-hidden="true"></span>`;
}

/** Tugmani loading holatiga o'tkazish / qaytarish */
function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.classList.add('is-loading');
    btn.disabled = true;
    if (!btn.querySelector('.spinner')) {
      btn.insertAdjacentHTML('beforeend', spinnerHtml('sm'));
    }
  } else {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    const sp = btn.querySelector('.spinner');
    if (sp) sp.remove();
  }
}

function showToast(message, type = 'info', duration = 2600) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ------------------------------------------------------------
// 4.4 — NETWORK-OFFLINE BANNER
// MANTIQ: toast'dan farqli — bu "hodisa" emas, "davomiy holat".
// Shuning uchun avtomatik yo'qolmaydi, faqat aloqa qaytganda
// (`online` event) yopiladi. `navigator.onLine` browser/webview'
// qo'llab-quvvatlaydigan joyda ishonchli signal (Telegram
// ilovasi ichida ham WebView orqali ishlaydi). Qaytganda ham
// bir zumga "qayta ulandi" holatini ko'rsatib, keyin yashiramiz —
// aks holda banner "sirg'alib yo'qolib" ketishi tushunarsiz
// bo'lib qolardi.
// ------------------------------------------------------------
(function initOfflineDetection() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  const label = banner.querySelector('span');
  const OFFLINE_TEXT = "Internet aloqasi yo'q";
  const RECONNECTED_TEXT = 'Qayta ulandi';
  let reconnectTimer = null;

  function showOffline() {
    clearTimeout(reconnectTimer);
    banner.classList.remove('is-success');
    if (label) label.textContent = OFFLINE_TEXT;
    banner.classList.add('is-visible');
  }

  function showReconnected() {
    if (!banner.classList.contains('is-visible')) return; // offline holatda bo'lmagan bo'lsa jim
    banner.classList.add('is-success');
    if (label) label.textContent = RECONNECTED_TEXT;
    reconnectTimer = setTimeout(() => {
      banner.classList.remove('is-visible', 'is-success');
    }, 1800);
  }

  window.addEventListener('offline', showOffline);
  window.addEventListener('online', showReconnected);

  // Sahifa ochilganda allaqachon offline bo'lsa — darhol ko'rsatamiz
  if (navigator.onLine === false) showOffline();
})();

// ------------------------------------------------------------
// SKELETON LOADER
// MANTIQ: haqiqiy content chizilishidan OLDIN shu shaklni
// ko'rsatamiz, keyin almashtiramiz. Bu "hech narsa yo'q" oq
// ekran o'rniga, kontent kelayotganini his qildiradi — hatto
// backend bo'lmasa ham (biz sun'iy delay qo'yamiz).
// ------------------------------------------------------------
function renderWorkerCardSkeletons(container, count = 3) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-worker-card">
        <div class="skeleton-row">
          <div class="skeleton-block skeleton-avatar"></div>
          <div class="gap-8" style="flex:1;">
            <div class="skeleton-block skeleton-line" style="width:60%;"></div>
            <div class="skeleton-block skeleton-line" style="width:40%; height:10px;"></div>
          </div>
        </div>
        <div class="skeleton-block skeleton-line" style="width:30%;"></div>
      </div>`;
  }
  container.innerHTML = html;
}

function renderFeedCardSkeletons(container, count = 4) {
  let html = '<div class="skeleton-feed-grid">';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-feed-card">
        <div class="skeleton-block"></div>
        <div class="skeleton-block skeleton-line" style="width:80%;"></div>
        <div class="skeleton-block skeleton-line" style="width:50%; height:10px;"></div>
      </div>`;
  }
  container.innerHTML = html + '</div>';
}

// ------------------------------------------------------------
// EMPTY / ERROR STATE
// MANTIQ: bitta universal funksiya — variant='error' bo'lsa
// qizil ikonka va standart "Qayta urinib ko'ring" tugmasi
// avtomatik qo'shiladi. Har bir chaqiruvchi joy endi 6 qatorlik
// HTML yozish o'rniga, bitta obyekt beradi.
// ------------------------------------------------------------
function renderEmptyState(container, { icon, title, body, variant = 'empty', actionLabel, onAction } = {}) {
  const defaultErrorIcon = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0z"/></svg>';
  const isError = variant === 'error';
  const finalIcon = icon || (isError ? defaultErrorIcon : '');
  const finalTitle = title || (isError ? 'Nimadir xato ketdi' : '');
  const finalBody = body || (isError ? 'Iltimos, qayta urinib ko\'ring' : '');
  const finalActionLabel = actionLabel || (isError ? 'Qayta urinib ko\'ring' : null);

  const btnId = 'state-action-' + Math.random().toString(36).slice(2, 8);

  container.innerHTML = `
    <div class="empty-state">
      ${finalIcon ? `<div class="empty-state-emoji${isError ? ' is-error' : ''}">${finalIcon}</div>` : ''}
      ${finalTitle ? `<div class="h2">${escapeHtml(finalTitle)}</div>` : ''}
      ${finalBody ? `<div class="body">${escapeHtml(finalBody)}</div>` : ''}
      ${finalActionLabel ? `<button class="state-action-btn" id="${btnId}">${escapeHtml(finalActionLabel)}</button>` : ''}
    </div>`;

  if (finalActionLabel && onAction) {
    document.getElementById(btnId).onclick = onAction;
  }
}

// ------------------------------------------------------------
// 9.4 — A/B VARIANT + 9.2 PROTOTIP DEEP-LINK
// ?ab=b → qisqa onboarding (B). ?screen=home → to'g'ridan-to'g'ri ekran
// (faqat mavjud data-screen; testchilar uchun).
// ------------------------------------------------------------
function getQueryParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch (e) {
    return null;
  }
}

function applyAbVariant() {
  const ab = (getQueryParam('ab') || 'a').toLowerCase();
  document.documentElement.setAttribute('data-ab', ab);
  if (ab !== 'b') return;

  // Variant B: qisqa onboarding — hikoya yashirinadi, CTA/tagline o'zgaradi
  const story = document.querySelector('.onboarding-story-text');
  if (story) story.hidden = true;
  const tagline = document.querySelector('.onboarding-tagline');
  if (tagline) tagline.textContent = 'Ishchi topish — 1 daqiqada';
  const primaryBtn = document.querySelector('.screen[data-screen="onboarding"] .btn-primary');
  if (primaryBtn) {
    // SVG ni saqlab, matnni almashtiramiz
    const svg = primaryBtn.querySelector('svg');
    primaryBtn.textContent = '';
    if (svg) primaryBtn.appendChild(svg);
    primaryBtn.appendChild(document.createTextNode(' Ro\'yxatdan o\'tish'));
  }
}

function getStartScreen() {
  const requested = getQueryParam('screen');
  if (!requested) return 'onboarding';
  const exists = document.querySelector(`.screen[data-screen="${requested}"]`);
  return exists ? requested : 'onboarding';
}

// ------------------------------------------------------------
// INIT
// MANTIQ: ilova endi ekranni chizishdan OLDIN backend'dan boshlang'ich
// ma'lumotlarni (viloyatlar, ko'nikmalar, ishchilar ro'yxati) yuklab
// oladi (loadInitialData(), data.js'da). Local serverda bu deyarli
// zumda tugaydi, shuning uchun foydalanuvchi uchun sezilarli kutish
// bo'lmaydi — lekin agar backend ishlamayotgan bo'lsa, konsolga xato
// chiqadi va ilova baribir (bo'sh ro'yxatlar bilan) ochiladi, sinmaydi.
//
// SESSIYANI TIKLASH: agar localStorage'da token bo'lsa (avval ro'yxatdan
// o'tgan/kirgan foydalanuvchi F5 bosgan) — GET /api/auth/me chaqirilib,
// muvaffaqiyatli bo'lsa onboarding umuman ko'rsatilmasdan to'g'ridan-
// to'g'ri "home"ga o'tiladi. Token eskirgan/bekor bo'lsa (masalan
// backend bazasi tozalangan) — apiRequest() uni avtomatik tozalaydi,
// shu payt oddiy onboarding oqimi davom etadi.
// ------------------------------------------------------------
async function restoreSession() {
  const token = getStoredToken();
  if (!token) return false;
  try {
    const user = await ChaqirAPI.getMe();
    appState.token = token;
    appState.id = user.id;
    appState.role = user.role;
    appState.name = user.name;
    appState.phone = user.phone;
    appState.region = user.region;
    appState.district = user.district;
    appState.mahalla = user.mahalla;
    appState.address = user.address;
    return true;
  } catch (e) {
    return false; // apiRequest() 401'da tokenni allaqachon tozaladi
  }
}

(async function boot() {
  initTelegramMiniApp();
  applyAbVariant();
  await loadInitialData();
  const restored = await restoreSession();
  if (restored) {
    await goHome();
  } else {
    renderScreen(getStartScreen());
  }
  // Telegram user ismi onboarding'dan oldin bo'lsa — state'ga
  applyTelegramUserDefaults();
})();


// ------------------------------------------------------------
// 2.3 — Keyboard / visualViewport layout protection
// Soft-keyboard ochilganda pastki tugmalar yashirinmasligi uchun
// device balandligini viewport height bilan sinxronlaymiz.
// ------------------------------------------------------------
(function syncVisualViewport() {
  function update() {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty('--vvh', h + 'px');
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', update);
    window.visualViewport.addEventListener('scroll', update);
  }
  window.addEventListener('resize', update);
  update();
})();
