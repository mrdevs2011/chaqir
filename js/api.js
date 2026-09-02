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

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      // Ngrok bepul tarifidagi bir martalik ogohlantirish sahifasini
      // (HTML interstitial) chetlab o'tish uchun — bo'lmasa fetch() JSON
      // o'rniga shu ogohlantirish HTML'ini qaytarib oladi.
      'ngrok-skip-browser-warning': 'true'
    },
    ...options
  });
  if (!res.ok) {
    let errMsg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && body.error) errMsg = body.error;
    } catch (e) { /* body JSON emas — status matni yetarli */ }
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

  // ---- Login (telefon bo'yicha qidirish) ----
  findUserByPhone(phone) {
    return apiRequest(`/api/users/by-phone/${encodeURIComponent(phone)}`);
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
  sendMessage(conversationId, senderId, text) {
    return apiRequest(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ sender_id: senderId, text })
    });
  }
};
