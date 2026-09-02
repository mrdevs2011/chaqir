/* ============================================================
   CHAQIR — API client
   Backend bilan gaplashuvchi yagona joy. Frontend (data.js/app.js)
   hech qachon to'g'ridan-to'g'ri fetch() chaqirmaydi — hammasi shu
   yerdagi ChaqirAPI.* funksiyalari orqali o'tadi.

   API_BASE bo'sh qoldirilgan — chunki server.js frontend'ni ham
   o'zi xizmat qiladi (public/), demak API va frontend bir xil
   origin'da (masalan http://localhost:3000 yoki ngrok domeningiz).
   Agar frontend boshqa joyda (masalan alohida statik hosting)
   joylashtirilsa, shu yerga to'liq backend URL'ini yozing:
     const API_BASE = 'https://your-ngrok-domain.ngrok-free.dev';
============================================================ */

// Frontend chaqir.vercel.app'da, backend esa alohida (ngrok) turadi —
// shuning uchun to'liq backend URL kerak. Ngrok domeningiz o'zgarsa,
// shu yerni yangilang.
const API_BASE = 'https://satisfy-endurance-mooned.ngrok-free.dev';

// ------------------------------------------------------------
// AUTH TOKEN — localStorage'da 'chaqir-token' kaliti bilan saqlanadi
// (xuddi 'chaqir-theme' kabi). Sahifa yangilansa (F5) ham foydalanuvchi
// kirgan holatda qolishi uchun app.js boot() ichida shu funksiyalar
// orqali o'qib/tozalab turadi.
// ------------------------------------------------------------
function getStoredToken() {
  try { return localStorage.getItem('chaqir-token'); } catch (e) { return null; }
}
function setStoredToken(token) {
  try {
    if (token) localStorage.setItem('chaqir-token', token);
    else localStorage.removeItem('chaqir-token');
  } catch (e) { /* localStorage yo'q bo'lsa ham UI ishlayveradi, faqat reload'da eslab qolmaydi */ }
}
function clearStoredToken() {
  setStoredToken(null);
}

async function apiRequest(path, options = {}) {
  const token = getStoredToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      // Ngrok bepul tarifidagi bir martalik ogohlantirish sahifasini
      // (HTML interstitial) chetlab o'tish uchun — bo'lmasa fetch() JSON
      // o'rniga shu ogohlantirish HTML'ini qaytarib oladi.
      'ngrok-skip-browser-warning': 'true',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    ...options
  });
  if (!res.ok) {
    let errMsg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && body.error) errMsg = body.error;
    } catch (e) { /* body JSON emas — status matni yetarli */ }
    // Token eskirgan/yaroqsiz bo'lsa — mahalliy nusxasini tozalaymiz,
    // shunda keyingi so'rovlar Authorization headerisiz ketadi va
    // frontend (restoreSession) buni onboarding'ga qaytarish signali
    // sifatida ishlatadi.
    if (res.status === 401) clearStoredToken();
    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const ChaqirAPI = {
  // ---- Location ----
  getRegions() {
    return apiRequest('/api/regions');
  },
  getDistricts(region) {
    return apiRequest(`/api/districts?region=${encodeURIComponent(region)}`);
  },
  getMahallas(district) {
    return apiRequest(`/api/mahallas?district=${encodeURIComponent(district)}`);
  },

  // ---- Skills ----
  getSkills() {
    return apiRequest('/api/skills');
  },

  // ---- Workers ----
  getWorkers(filters = {}) {
    const params = new URLSearchParams();
    if (filters.skills && filters.skills.length) params.set('skills', filters.skills.join(','));
    if (filters.region) params.set('region', filters.region);
    if (filters.district) params.set('district', filters.district);
    if (filters.q) params.set('q', filters.q);
    const qs = params.toString();
    return apiRequest(`/api/workers${qs ? `?${qs}` : ''}`);
  },
  getWorker(id) {
    return apiRequest(`/api/workers/${id}`);
  },
  registerWorker(data) {
    return apiRequest('/api/workers', { method: 'POST', body: JSON.stringify(data) });
  },

  // ---- Employers ----
  registerEmployer(data) {
    return apiRequest('/api/employers', { method: 'POST', body: JSON.stringify(data) });
  },

  // ---- Login (telefon bo'yicha qidirish — eski/demo yo'l) ----
  findUserByPhone(phone) {
    return apiRequest(`/api/users/by-phone/${encodeURIComponent(phone)}`);
  },

  // ---- Auth ----
  loginTelegram(initData) {
    return apiRequest('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) });
  },
  loginPassword(phone, password) {
    return apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) });
  },
  getMe() {
    return apiRequest('/api/auth/me');
  },
  logout() {
    return apiRequest('/api/auth/logout', { method: 'POST' });
  },
  createTransferCode() {
    return apiRequest('/api/auth/transfer', { method: 'POST' });
  },
  consumeTransferCode(code) {
    return apiRequest('/api/auth/transfer/consume', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
  },

  // ---- Favorites ----
  getFavorites(employerId) {
    return apiRequest(`/api/employers/${employerId}/favorites`);
  },
  addFavorite(employerId, workerId) {
    return apiRequest(`/api/employers/${employerId}/favorites/${workerId}`, { method: 'POST' });
  },
  removeFavorite(employerId, workerId) {
    return apiRequest(`/api/employers/${employerId}/favorites/${workerId}`, { method: 'DELETE' });
  },

  // ---- Orders ----
  getOrders(workerId) {
    return apiRequest(`/api/orders?worker_id=${workerId}`);
  },
  createOrder(data) {
    return apiRequest('/api/orders', { method: 'POST', body: JSON.stringify(data) });
  },
  updateOrderStatus(orderId, status) {
    return apiRequest(`/api/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },

  // ---- Conversations / messages ----
  getConversations(userId) {
    return apiRequest(`/api/conversations?user_id=${userId}`);
  },
  // Backend user_a_id ni token egasidan oladi — faqat user_b_id yuboriladi.
  createConversation(userBId) {
    return apiRequest('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ user_b_id: userBId })
    });
  },
  // sender_id backendda token egasidan olinadi — faqat text yuboriladi.
  sendMessage(conversationId, text) {
    return apiRequest(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text })
    });
  },

  // Suhbatni o'qilgan deb belgilash (unread hisoblagich uchun)
  markConversationRead(conversationId) {
    return apiRequest(`/api/conversations/${conversationId}/read`, { method: 'POST' });
  },

  // ---- Profile / portfolio / reviews ----
  updateMe(data) {
    return apiRequest('/api/me', { method: 'PATCH', body: JSON.stringify(data) });
  },
  addPortfolio(workerId, { url, caption }) {
    return apiRequest(`/api/workers/${workerId}/portfolio`, {
      method: 'POST',
      body: JSON.stringify({ url, caption })
    });
  },
  removePortfolio(workerId, itemId) {
    return apiRequest(`/api/workers/${workerId}/portfolio/${itemId}`, { method: 'DELETE' });
  },
  addReview(workerId, { rating, text }) {
    return apiRequest(`/api/workers/${workerId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, text })
    });
  }
};
