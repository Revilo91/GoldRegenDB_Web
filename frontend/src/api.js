const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(url, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${url}`, { headers, ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const errorMessage = err.error || err.message || res.statusText || 'Request failed';

    // Bei SumUp-Import Debug-Infos in Console loggen
    if (url.includes('/sumup/import') && err.verfuegbareSpalten) {
      console.error('SumUp Import Fehler-Details:', {
        verfuegbareSpalten: err.verfuegbareSpalten,
        beispieldaten: err.beispieldaten,
        hinweis: err.hinweis
      });
    }

    throw new Error(errorMessage);
  }
  return res.json();
}

async function downloadBlob(url) {
  const token = getToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${url}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || res.statusText || 'Download fehlgeschlagen');
  }

  return res.blob();
}

export const authApi = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/auth/me'),
};

export const api = {
  // Dashboard
  getDashboard: () => request('/dashboard'),

  // Kunden
  getKunden: () => request('/kunden'),
  getKunde: (id) => request(`/kunden/${id}`),
  getKundeSchmuck: (id) => request(`/kunden/${id}/schmuckstuecke`),
  createKunde: (data) => request('/kunden', { method: 'POST', body: JSON.stringify(data) }),
  updateKunde: (id, data) => request(`/kunden/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKunde: (id) => request(`/kunden/${id}`, { method: 'DELETE' }),

  // Schmuckstücke
  getSchmuckstuecke: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/schmuckstuecke?${qs}`);
  },
  getFilterOptions: () => request('/schmuckstuecke/filter-options'),
  getSchmuckstueck: (nr) => request(`/schmuckstuecke/${nr}`),
  createSchmuckstueck: (data) => request('/schmuckstuecke', { method: 'POST', body: JSON.stringify(data) }),
  updateSchmuckstueck: (nr, data) => request(`/schmuckstuecke/${nr}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSchmuckstueck: (nr) => request(`/schmuckstuecke/${nr}`, { method: 'DELETE' }),

  // Lieferscheine
  getLieferscheine: () => request('/lieferscheine'),
  getLieferschein: (id) => request(`/lieferscheine/${id}`),
  createLieferschein: (data) => request('/lieferscheine', { method: 'POST', body: JSON.stringify(data) }),
  updateLieferschein: (id, data) => request(`/lieferscheine/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLieferschein: (id) => request(`/lieferscheine/${id}`, { method: 'DELETE' }),

  // Rechnungen
  getRechnungen: () => request('/rechnungen'),
  getRechnung: (id) => request(`/rechnungen/${id}`),
  createRechnung: (data) => request('/rechnungen', { method: 'POST', body: JSON.stringify(data) }),
  updateRechnung: (id, data) => request(`/rechnungen/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRechnung: (id) => request(`/rechnungen/${id}`, { method: 'DELETE' }),

  // Audit Log
  getAuditLog: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/audit-log?${qs}`);
  },
  getAuditLogForArtikel: (nr) => request(`/audit-log/artikel/${nr}`),

  // Excel Export
  exportLieferscheinExcel: (id) => downloadBlob(`/lieferscheine/${id}/excel`),
  exportRechnungExcel: (id) => downloadBlob(`/rechnungen/${id}/excel`),

  // Sumup
  // Export - Blob-Download mit Token
  exportSumupCsv: () => downloadBlob('/sumup/export'),

  // Import
  importSumupCsv: (csvText) =>
    request('/sumup/import', { method: 'POST', body: JSON.stringify({ csvData: csvText }) }),

  // Benutzerverwaltung
  getUsers: () => request('/users'),
  getUser: (id) => request(`/users/${id}`),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  resetUserPassword: (id, newPassword) => request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) }),

  // Datensicherung (Backup / Restore)
  exportBackup: () => downloadBlob('/backup/export'),
  importBackup: (data) =>
    request('/backup/import', { method: 'POST', body: JSON.stringify(data) }),
};
