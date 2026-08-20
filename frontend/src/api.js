const API_URL = import.meta.env.VITE_API_URL || '/api';

// Das JWT liegt seit Issue #132 in einem httpOnly-Cookie. Der Browser sendet es
// automatisch mit, sofern credentials: 'include' gesetzt ist – im Code gibt es
// deshalb kein Token mehr, das gelesen oder gespeichert werden müsste.

// ── CSRF (Issue #135) ────────────────────────────────────────────────────────
// Das Backend legt ein lesbares Cookie ab; wir spiegeln dessen Wert im Header
// zurück. Fremde Seiten können den Cookie zwar mitsenden lassen, ihn aber
// wegen der Same-Origin-Policy nicht auslesen und damit den Header nicht setzen.

const CSRF_COOKIE_NAME = 'csrfToken';
const AENDERNDE_METHODEN = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfTokenAusCookie() {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`))
    ?.slice(CSRF_COOKIE_NAME.length + 1);
}

// Mehrere parallele Requests sollen nur eine Anforderung auslösen
let csrfAnforderung = null;

async function ensureCsrfToken(erzwingen = false) {
  if (!erzwingen) {
    const vorhanden = csrfTokenAusCookie();
    if (vorhanden) return vorhanden;
  }
  if (!csrfAnforderung) {
    csrfAnforderung = fetch(`${API_URL}/csrf-token`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { csrfToken: null }))
      .then(({ csrfToken }) => csrfToken)
      .catch(() => null)
      .finally(() => {
        csrfAnforderung = null;
      });
  }
  return csrfAnforderung;
}

// frischesCsrfToken wird nur beim Wiederholungsversuch gesetzt: das Cookie
// trägt zu dem Zeitpunkt womöglich noch den alten Wert.
async function request(url, options = {}, frischesCsrfToken = null) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData ? { ...options.headers } : { 'Content-Type': 'application/json', ...options.headers };

  const method = (options.method || 'GET').toUpperCase();
  if (AENDERNDE_METHODEN.has(method)) {
    const csrfToken = frischesCsrfToken || (await ensureCsrfToken());
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  try {
    const res = await fetch(`${API_URL}${url}`, { credentials: 'include', headers, ...options });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      // Abgelaufenes oder fehlendes CSRF-Token: einmal neu holen und wiederholen
      if (res.status === 403 && err.code === 'CSRF_TOKEN_INVALID' && !frischesCsrfToken) {
        const neuesToken = await ensureCsrfToken(true);
        if (neuesToken) {
          return request(url, options, neuesToken);
        }
      }
      const errorMessage = err.error || err.message || res.statusText || 'Request failed';
      const requestError = new Error(errorMessage);
      requestError.status = res.status;
      requestError.payload = err;
      throw requestError;
    }
    return res.json();
  } catch (err) {
    if (!err.message || err.message === 'Failed to fetch') {
      throw new Error('Backend nicht erreichbar – bitte prüfen Sie, ob der Server läuft.');
    }
    throw err;
  }
}

async function downloadBlob(url, options = {}) {
  const { signal, onProgress, returnMetadata = false } = options;

  try {
    const res = await fetch(`${API_URL}${url}`, { credentials: 'include', signal });
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      let err = contentType.includes('application/json')
        ? await res.json().catch(() => ({ error: res.statusText }))
        : { error: res.statusText };
      const errorMessage = err.error || err.message || res.statusText || 'Download fehlgeschlagen';
      const requestError = new Error(errorMessage);
      requestError.status = res.status;
      requestError.payload = err;
      throw requestError;
    }

    const totalBytes = Number(res.headers.get('content-length')) || null;
    const uploadFileCount = Number(res.headers.get('x-upload-file-count')) || null;
    let blob;

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let loadedBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loadedBytes += value.length;
        if (onProgress) onProgress({ loadedBytes, totalBytes, progressPercent: totalBytes ? Math.round((loadedBytes / totalBytes) * 100) : null, uploadFileCount });
      }
      blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
    } else {
      blob = await res.blob();
      if (onProgress) onProgress({ loadedBytes: blob.size, totalBytes: blob.size, progressPercent: 100, uploadFileCount });
    }

    return returnMetadata ? { blob, metadata: { totalBytes, uploadFileCount, contentType: res.headers.get('content-type') } } : blob;
  } catch (err) {
    if (!err.message || err.message === 'Failed to fetch') {
      throw new Error('Backend nicht erreichbar – bitte prüfen Sie, ob der Server läuft.');
    }
    throw err;
  }
}

// ── Foto-Cache ───────────────────────────────────────────────────────────────
// Jede Tabellenzeile lädt ihr Foto einzeln. Ohne Cache erzeugt jeder
// Seitenwechsel erneut so viele Requests, wie die Seite Zeilen hat.

const FOTO_CACHE_MAX = 400;
const fotoCache = new Map();
const fotoRequests = new Map();

function merkeFoto(fileName, dataUrl) {
  if (fotoCache.size >= FOTO_CACHE_MAX) {
    fotoCache.delete(fotoCache.keys().next().value);
  }
  fotoCache.set(fileName, dataUrl);
}

function vergissFoto(artikelnummer) {
  const basis = String(artikelnummer || '').split('_')[0];
  if (!basis) return;
  const gehoertDazu = (key) => key.split('.')[0].split('_')[0] === basis;
  for (const key of [...fotoCache.keys()]) {
    if (gehoertDazu(key)) fotoCache.delete(key);
  }
  for (const key of [...fotoRequests.keys()]) {
    if (gehoertDazu(key)) fotoRequests.delete(key);
  }
}

// Kein AbortSignal: Der Request wird geteilt, ein abbrechender Aufrufer würde
// ihn sonst auch für alle anderen Wartenden beenden.
async function ladeFotoAlsDataUrl(cleanFileName) {
  const blob = await downloadBlob(`/schmuckstuecke/foto/${cleanFileName}`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(reader.error || new Error('Foto konnte nicht gelesen werden'));
    reader.readAsDataURL(blob);
  });
}

// Passwörter werden im Klartext über TLS gesendet und erst im Backend mit
// bcrypt gehasht (siehe backend/src/utils/passwordService.js).
export const authApi = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),
  // Erzeugt ein Reset-Token. Solange kein Mailversand konfiguriert ist, gibt das
  // Backend den Link nur ins Log aus – siehe backend/src/routes/auth.js.
  forgotPassword: (username) =>
    request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ username }) }),
  resetPassword: (token, newPassword) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),
};

export const publicApi = {
  // Öffentliches Bestellformular (ohne Login) – siehe backend/src/routes/bestellungPublic.js
  createBestellung: (data) => request('/public/bestellung', { method: 'POST', body: JSON.stringify(data) }),
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
  getUniqueArtikelnummern: (params) => {
    const qs = params ? new URLSearchParams(params).toString() : '';
    return request(`/schmuckstuecke/unique-artikelnummern?${qs}`);
  },
  getFilterOptions: () => request('/schmuckstuecke/filter-options'),
  getNextArtikelnummer: (prefix) => request(`/schmuckstuecke/next-artikelnummer?${new URLSearchParams({ prefix }).toString()}`),
  getSchmuckstueck: (nr) => request(`/schmuckstuecke/${nr}`),
  createSchmuckstueck: (data) => request('/schmuckstuecke', { method: 'POST', body: JSON.stringify(data) }),
  createSchmuckstueckeBulk: (data) => request('/schmuckstuecke/bulk', { method: 'POST', body: JSON.stringify(data) }),
  updateSchmuckstueck: (nr, data) => request(`/schmuckstuecke/${nr}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSchmuckstueck: (nr) => request(`/schmuckstuecke/${nr}`, { method: 'DELETE' }),
  uploadFoto: (file, artikelnummer) => {
    const formData = new FormData();
    formData.append('foto', file);
    const qs = new URLSearchParams({ artikelnummer }).toString();
    // Das Backend legt die Datei unter der Basis-Artikelnummer ab, überschreibt
    // also den bisherigen Dateinamen – der Cache-Eintrag muss deshalb weg.
    vergissFoto(artikelnummer);
    return request(`/schmuckstuecke/upload?${qs}`, { method: 'POST', body: formData });
  },
  getPhotoUrl: (fileName) => fileName ? `${API_URL}/schmuckstuecke/foto/${fileName}` : null,
  loadPhotoAsDataUrl: async (fileName, options = {}) => {
    if (!fileName) return null;
    const cleanFileName = fileName.replace(/^uploads[\\/]/, '');

    const zwischengespeichert = fotoCache.get(cleanFileName);
    if (zwischengespeichert) return zwischengespeichert;

    // Beim Blättern und beim Wechsel zwischen Tabelle und Detailansicht werden
    // dieselben Fotos immer wieder angefragt. Laufende Requests werden geteilt,
    // fertige Data-URLs bleiben für die Sitzung im Speicher.
    let laufend = fotoRequests.get(cleanFileName);
    if (!laufend) {
      laufend = ladeFotoAlsDataUrl(cleanFileName)
        .then((dataUrl) => {
          if (dataUrl) merkeFoto(cleanFileName, dataUrl);
          return dataUrl;
        })
        .finally(() => fotoRequests.delete(cleanFileName));
      fotoRequests.set(cleanFileName, laufend);
    }

    try {
      return await laufend;
    } catch (err) {
      if (err?.name === 'AbortError' || options.signal?.aborted) return null;
      const message = `Foto ${fileName} konnte nicht geladen werden: ${err.message}`;
      const photoError = new Error(message);
      photoError.status = err.status;
      photoError.payload = err.payload;
      throw photoError;
    }
  },
  clearPhotoCache: () => {
    fotoCache.clear();
    fotoRequests.clear();
  },

  // Lieferscheine
  getLieferscheine: () => request('/lieferscheine'),
  getNextLieferscheinnummer: () => request('/lieferscheine/next-number'),
  getLieferschein: (id) => request(`/lieferscheine/${id}`),
  createLieferschein: (data) => request('/lieferscheine', { method: 'POST', body: JSON.stringify(data) }),
  updateLieferschein: (id, data) => request(`/lieferscheine/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLieferschein: (id) => request(`/lieferscheine/${id}`, { method: 'DELETE' }),

  // Bestellübersicht (DSGVO)
  getBestellungen: () => request('/bestelluebersicht'),
  getBestellung: (id) => request(`/bestelluebersicht/${id}`),
  getNextBestellnummer: () => request('/bestelluebersicht/next-number'),
  createBestellung: (data) => request('/bestelluebersicht', { method: 'POST', body: JSON.stringify(data) }),
  updateBestellung: (id, data) => request(`/bestelluebersicht/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  anonymisiereBestellungKunde: (id) => request(`/bestelluebersicht/${id}/anonymisieren`, { method: 'POST', body: JSON.stringify({}) }),

  // Rechnungen
  getRechnungen: () => request('/rechnungen'),
  getNextRechnungsnummer: () => request('/rechnungen/next-number'),
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
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  resetUserPassword: (id, newPassword) =>
    request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) }),

  // Datensicherung (Backup / Restore)
  exportBackup: (tables) => {
    const params = new URLSearchParams();
    if (tables && tables.length) {
      params.set('tables', tables.join(','));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return downloadBlob(`/backup/export${query}`);
  },
  exportBackupUploadsZip: (options = {}) => downloadBlob('/backup/export-uploads', options),
  startBackupUploadsExportJob: () => request('/backup/export-uploads-jobs', { method: 'POST' }),
  getBackupUploadsExportJob: (jobId) => request(`/backup/export-uploads-jobs/${jobId}`),
  downloadBackupUploadsExportJob: (jobId, options = {}) =>
    downloadBlob(`/backup/export-uploads-jobs/${jobId}/download`, options),
  importBackup: (data, selectedTables) => {
    const payload = {
      backupData: data,
      selectedTables: selectedTables || null,
    };
    return request('/backup/import', { method: 'POST', body: JSON.stringify(payload) });
  },
  importBackupUploadsZip: (file) => {
    const formData = new FormData();
    formData.append('uploadsZip', file);
    // request() erkennt FormData selbst und setzt dann keinen Content-Type
    return request('/backup/import-uploads-zip', { method: 'POST', body: formData });
  },

  // Inventur
  getInventur: () => request('/inventur'),
  getInventurKunde: (kundeId) => request(`/inventur/${kundeId}`),
  exportInventurExcel: (kundeId) => downloadBlob(`/inventur/${kundeId}/excel`),

  // Lager-Inventur (Entwürfe)
  getInventurDrafts: () => request('/lagerinventur/drafts'),
  getInventurDraft: (id) => request(`/lagerinventur/drafts/${id}`),
  createInventurDraft: (data) => request('/lagerinventur/drafts', { method: 'POST', body: JSON.stringify(data) }),
  updateInventurDraft: (id, data) => request(`/lagerinventur/drafts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  completeInventurDraft: (id) => request(`/lagerinventur/drafts/${id}/complete`, { method: 'POST', body: JSON.stringify({}) }),
  getInventurDiff: (id) => request(`/lagerinventur/drafts/${id}/diff`),
};
