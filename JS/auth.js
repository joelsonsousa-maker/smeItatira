// Simple auth helper: read/set/clear token from multiple storages and fetch /api/auth/me
(function () {
  const STORAGE_KEYS = ['sme_session_token', 'token', 'session_token'];
  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3000' : '';

  function readFromLocalStorage() {
    try {
      for (const k of STORAGE_KEYS) {
        const v = localStorage.getItem(k);
        if (v) return v;
      }
    } catch (e) {}
    try {
      for (const k of STORAGE_KEYS) {
        const v = sessionStorage.getItem(k);
        if (v) return v;
      }
    } catch (e) {}
    // cookies
    try {
      const cookies = document.cookie ? document.cookie.split(';').map(c=>c.trim()) : [];
      for (const c of cookies) {
        for (const k of STORAGE_KEYS) {
          if (c.startsWith(k + '=')) return decodeURIComponent(c.split('=')[1] || '');
        }
      }
    } catch (e) {}
    return null;
  }

  async function fetchMe(token) {
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const body = await res.json();
      return body.ok ? body.user : null;
    } catch (e) { return null; }
  }

  function setToken(token, { persist = true } = {}) {
    try { if (persist) localStorage.setItem('sme_session_token', token); else sessionStorage.setItem('sme_session_token', token); } catch (e) {}
    try { document.cookie = `sme_session_token=${encodeURIComponent(token)}; path=/`; } catch (e) {}
  }

  function clearToken() {
    try { STORAGE_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) {}
    try { STORAGE_KEYS.forEach(k => sessionStorage.removeItem(k)); } catch (e) {}
    try { document.cookie = 'sme_session_token=; path=/; max-age=0'; } catch (e) {}
  }

  window.SMEAuth = { readToken: readFromLocalStorage, fetchMe, setToken, clearToken };
})();
