import { hashPassword } from './utils/hashPassword';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const LOG_PREFIX = '[FRONTEND/API]';

function logInfo(message, meta) {
  console.log(`${new Date().toISOString()} ${LOG_PREFIX} ${message}`, meta !== undefined ? meta : '');
}

function logError(message, meta) {
  console.error(`${new Date().toISOString()} ${LOG_PREFIX} ${message}`, meta !== undefined ? meta : '');
}

logInfo(`API-Client initialisiert. API_URL=${API_URL}`);

function getToken() {
  return localStorage.getItem('token');
}

async function request(url, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const method = options.method || 'GET';
  logInfo(`→ ${method} ${url}`);
  const startTime = Date.now();
  try {
    const res = await fetch(`${API_URL}${url}`, { headers, ...options });
    const duration = Date.now() - startTime;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const errorMessage = err.error || err.message || res.statusText || 'Request failed';
      logError(`← ${method} ${url} → ${res.status} (${duration}ms): ${errorMessage}`);

      // Bei SumUp-Import Debug-Infos in Console loggen
      if (url.includes('/sumup/import') && err.verfuegbareSpalten) {
        logError('SumUp Import Fehler-Details:', {
          verfuegbareSpalten: err.verfuegbareSpalten,
          beispieldaten: err.beispieldaten,
          hinweis: err.hinweis
        });
      }

      const requestError = new Error(errorMessage);
      requestError.status = res.status;
      requestError.payload = err;
      throw requestError;
    }
    logInfo(`← ${method} ${url} → ${res.status} (${duration}ms)`);
    return res.json();
  } catch (err) {
    if (!err.message || err.message === 'Failed to fetch') {
      const duration = Date.now() - startTime;
      logError(`← ${method} ${url} → Netzwerkfehler (${duration}ms): Backend nicht erreichbar`);
      throw new Error('Backend nicht erreichbar – bitte prüfen Sie, ob der Server läuft.');
    }
    throw err;
  }
}

async function requestFormData(url, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const method = options.method || 'GET';
  logInfo(`→ ${method} ${url} (FormData)`);
  const startTime = Date.now();
  try {
    const res = await fetch(`${API_URL}${url}`, { headers, ...options });
    const duration = Date.now() - startTime;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const errorMessage = err.error || err.message || res.statusText || 'Request failed';
      logError(`← ${method} ${url} → ${res.status} (${duration}ms): ${errorMessage}`);
      throw new Error(errorMessage);
    }
    logInfo(`← ${method} ${url} → ${res.status} (${duration}ms)`);
    return res.json();
  } catch (err) {
    if (!err.message || err.message === 'Failed to fetch') {
      const duration = Date.now() - startTime;
      logError(`← ${method} ${url} → Netzwerkfehler (${duration}ms): Backend nicht erreichbar`);
      throw new Error('Backend nicht erreichbar – bitte prüfen Sie, ob der Server läuft.');
    }
    throw err;
  }
}

async function downloadBlob(url) {
  const token = getToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  logInfo(`→ GET ${url} (Download)`);
  const startTime = Date.now();
  try {
    const res = await fetch(`${API_URL}${url}`, { headers });
    const duration = Date.now() - startTime;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      logError(`← GET ${url} → ${res.status} (${duration}ms): Download fehlgeschlagen`);
      throw new Error(err.error || err.message || res.statusText || 'Download fehlgeschlagen');
    }
    logInfo(`← GET ${url} → ${res.status} (${duration}ms)`);
    return res.blob();
  } catch (err) {
    if (!err.message || err.message === 'Failed to fetch') {
      const duration = Date.now() - startTime;
      logError(`← GET ${url} → Netzwerkfehler (${duration}ms): Backend nicht erreichbar`);
      throw new Error('Backend nicht erreichbar – bitte prüfen Sie, ob der Server läuft.');
    }
    throw err;
  }
}

export const authApi = {
  login: async (username, password) => {
    const hashedPassword = await hashPassword(password);
    return request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password: hashedPassword }) });
  },
  me: () => request('/auth/me'),
  changePassword: async (currentPassword, newPassword) => {
    const hashedCurrentPassword = await hashPassword(currentPassword);
    const hashedNewPassword = await hashPassword(newPassword);
    return request('/auth/change-password', { method: 'PUT', body: JSON.stringify({ currentPassword: hashedCurrentPassword, newPassword: hashedNewPassword }) });
  },
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
  restockKunde: (id) => request(`/kunden/${id}/restock`, { method: 'PUT', body: JSON.stringify({}) }),
  restockKundeSelective: (id, artikelnummern) => request(`/kunden/${id}/restock-selective`, { method: 'PUT', body: JSON.stringify({ artikelnummern }) }),

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
  uploadFoto: (file, artikelnummer) => {
    const formData = new FormData();
    formData.append('foto', file);
    const qs = new URLSearchParams({ artikelnummer }).toString();
    return requestFormData(`/schmuckstuecke/upload?${qs}`, { method: 'POST', body: formData });
  },
  getPhotoUrl: (fileName) => fileName ? `${API_URL}/schmuckstuecke/foto/${fileName}` : null,
  loadPhotoAsDataUrl: async (fileName) => {
    if (!fileName) return null;
    try {
      console.log('🔍 Versuche Foto zu laden:', fileName);
      // Entferne "uploads/" Prefix falls vorhanden (für alte DB-Einträge)
      const cleanFileName = fileName.replace(/^uploads[\\/]/, '');
      console.log('📝 Bereinigter Dateiname:', cleanFileName);
      const blob = await downloadBlob(`/schmuckstuecke/foto/${cleanFileName}`);
      console.log('✅ Foto erfolgreich heruntergeladen, Größe:', blob.size);
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          console.log('✅ Foto zu DataURL konvertiert');
          resolve(e.target.result);
        };
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('❌ Fehler beim Laden des Fotos:', fileName, err);
      return null;
    }
  },

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

  // Debug (Admin)
  getDebugTables: () => request('/debug/tables'),
  getDebugTableData: (tableName) => request(`/debug/tables/${tableName}`),
  updateDebugCell: (tableName, payload) =>
    request(`/debug/tables/${tableName}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

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
  createUser: async (data) => {
    const payload = { ...data };
    if (payload.password) {
      payload.password = await hashPassword(payload.password);
    }
    return request('/users', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  resetUserPassword: async (id, newPassword) => {
    const hashedPassword = await hashPassword(newPassword);
    return request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword: hashedPassword }) });
  },

  // Datensicherung (Backup / Restore)
  exportBackup: () => downloadBlob('/backup/export'),
  importBackup: (data) =>
    request('/backup/import', { method: 'POST', body: JSON.stringify(data) }),

  // Inventur
  getInventur: () => request('/inventur'),
  getInventurKunde: (kundeId) => request(`/inventur/${kundeId}`),
  exportInventurExcel: (kundeId) => downloadBlob(`/inventur/${kundeId}/excel`),
};
