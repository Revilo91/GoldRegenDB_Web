import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Test für die transiente Fehler-Erkennung bei Bilder-Backup-Downloads
 * 
 * Testet die Resilienz der Polling-Logik gegen temporäre 5xx/Timeout-Fehler
 */

// Diese Funktion wird aus Datensicherung.jsx exportiert (muss später angepasst werden)
function isTransientExportStatusError(error) {
  if (!error) return false;

  const status = error?.status;
  if (status === 502 || status === 503 || status === 504 || status === 429) {
    return true;
  }

  const message = typeof error === "string" ? error : error.message || "";
  return /timeout|timed out|gateway|failed to fetch|netzwerk|backend nicht erreichbar/i.test(
    message,
  );
}

describe('isTransientExportStatusError', () => {
  it('erkennt HTTP 504 Gateway Timeout als transient', () => {
    const error = new Error('Gateway Timeout');
    error.status = 504;
    expect(isTransientExportStatusError(error)).toBe(true);
  });

  it('erkennt HTTP 502 Bad Gateway als transient', () => {
    const error = new Error('Bad Gateway');
    error.status = 502;
    expect(isTransientExportStatusError(error)).toBe(true);
  });

  it('erkennt HTTP 503 Service Unavailable als transient', () => {
    const error = new Error('Service Unavailable');
    error.status = 503;
    expect(isTransientExportStatusError(error)).toBe(true);
  });

  it('erkennt HTTP 429 Too Many Requests als transient', () => {
    const error = new Error('Rate Limited');
    error.status = 429;
    expect(isTransientExportStatusError(error)).toBe(true);
  });

  it('erkennt "timeout" in Fehlermeldung', () => {
    const error = new Error('Request timeout');
    expect(isTransientExportStatusError(error)).toBe(true);
  });

  it('erkennt "timed out" in Fehlermeldung', () => {
    const error = new Error('Connection timed out');
    expect(isTransientExportStatusError(error)).toBe(true);
  });

  it('erkennt "gateway" in Fehlermeldung', () => {
    const error = new Error('Gateway error occurred');
    expect(isTransientExportStatusError(error)).toBe(true);
  });

  it('erkennt "failed to fetch" als transient', () => {
    const error = new Error('Failed to fetch');
    expect(isTransientExportStatusError(error)).toBe(true);
  });

  it('erkennt "backend nicht erreichbar" als transient', () => {
    const error = new Error('Backend nicht erreichbar');
    expect(isTransientExportStatusError(error)).toBe(true);
  });

  it('akzeptiert String-Fehlermeldungen', () => {
    expect(isTransientExportStatusError('Request timeout')).toBe(true);
  });

  it('lehnt HTTP 404 Not Found ab (nicht transient)', () => {
    const error = new Error('Not Found');
    error.status = 404;
    expect(isTransientExportStatusError(error)).toBe(false);
  });

  it('lehnt HTTP 400 Bad Request ab (nicht transient)', () => {
    const error = new Error('Bad Request');
    error.status = 400;
    expect(isTransientExportStatusError(error)).toBe(false);
  });

  it('lehnt HTTP 401 Unauthorized ab (nicht transient)', () => {
    const error = new Error('Unauthorized');
    error.status = 401;
    expect(isTransientExportStatusError(error)).toBe(false);
  });

  it('lehnt HTTP 500 Internal Server Error ab (nicht transient)', () => {
    const error = new Error('Internal Server Error');
    error.status = 500;
    expect(isTransientExportStatusError(error)).toBe(false);
  });

  it('lehnt generische Fehlermeldungen ohne Timeout-Indikator ab', () => {
    const error = new Error('Something went wrong');
    expect(isTransientExportStatusError(error)).toBe(false);
  });

  it('gibt false zurück für null/undefined', () => {
    expect(isTransientExportStatusError(null)).toBe(false);
    expect(isTransientExportStatusError(undefined)).toBe(false);
  });

  it('ignoriert Groß-/Kleinschreibung bei Fehlermeldungen', () => {
    expect(isTransientExportStatusError('TIMEOUT')).toBe(true);
    expect(isTransientExportStatusError('GateWay Error')).toBe(true);
    expect(isTransientExportStatusError('Failed TO FETCH')).toBe(true);
  });
});

/**
 * Test für die Polling-Logik mit Retry-Backoff
 */
describe('waitForUploadsExportJob Polling mit Retry-Backoff', () => {
  let mockApi;

  beforeEach(() => {
    mockApi = {
      getBackupUploadsExportJob: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('gibt Job zurück wenn Status "completed" ist', async () => {
    const completedJob = {
      id: 'job-123',
      status: 'completed',
      totalFiles: 5,
      processedFiles: 5,
      fileName: 'backup.zip',
    };

    mockApi.getBackupUploadsExportJob.mockResolvedValueOnce({
      job: completedJob,
    });

    const result = await waitForUploadsExportJobWithoutTimer(mockApi, 'job-123');
    expect(result).toEqual(completedJob);
    expect(mockApi.getBackupUploadsExportJob).toHaveBeenCalledOnce();
  });

  it('wirft Fehler wenn Job Status "failed" ist', async () => {
    const failedJob = {
      id: 'job-123',
      status: 'failed',
      error: {
        message: 'Datei konnte nicht gelesen werden',
        fileName: 'image.jpg',
      },
    };

    mockApi.getBackupUploadsExportJob.mockResolvedValueOnce({
      job: failedJob,
    });

    await expect(waitForUploadsExportJobWithoutTimer(mockApi, 'job-123')).rejects.toThrow(
      /Datei konnte nicht gelesen werden/,
    );
  });

  it('retriggert bei transienten Fehlern (504)', async () => {
    const completedJob = {
      id: 'job-123',
      status: 'completed',
      totalFiles: 5,
      processedFiles: 5,
    };

    // Erste 2 Aufrufe: 504-Fehler
    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(createError('Gateway', 504));
    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(createError('Gateway', 504));
    // Dritter Aufruf: Erfolg
    mockApi.getBackupUploadsExportJob.mockResolvedValueOnce({ job: completedJob });

    const result = await waitForUploadsExportJobWithoutTimer(mockApi, 'job-123');
    expect(result).toEqual(completedJob);
    expect(mockApi.getBackupUploadsExportJob).toHaveBeenCalledTimes(3);
  });

  it('wirft sofort bei nicht-transienten Fehlern (401)', async () => {
    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(
      createError('Unauthorized', 401),
    );

    await expect(waitForUploadsExportJobWithoutTimer(mockApi, 'job-123')).rejects.toThrow(
      /Unauthorized/,
    );
    expect(mockApi.getBackupUploadsExportJob).toHaveBeenCalledOnce();
  });

  it('stoppt nach 30 aufeinanderfolgenden transienten Fehlern', async () => {
    for (let i = 0; i < 30; i++) {
      mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(
        createError('Gateway', 504),
      );
    }

    await expect(waitForUploadsExportJobWithoutTimer(mockApi, 'job-123')).rejects.toThrow(
      /Statusabfrage.*fehlgeschlagen/,
    );
    expect(mockApi.getBackupUploadsExportJob).toHaveBeenCalledTimes(30);
  });

  it('setzt Fehler-Counter zurück nach erfolgreicher Abfrage', async () => {
    const pendingJob = { id: 'job-123', status: 'running', totalFiles: 0, processedFiles: 0 };
    const completedJob = {
      id: 'job-123',
      status: 'completed',
      totalFiles: 5,
      processedFiles: 5,
    };

    // 504 → Fehler-Counter = 1
    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(createError('Gateway', 504));
    // Erfolg → Fehler-Counter = 0
    mockApi.getBackupUploadsExportJob.mockResolvedValueOnce({ job: pendingJob });
    // 504 → Fehler-Counter = 1 (nicht kumulativ!)
    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(createError('Gateway', 504));
    // 504 → Fehler-Counter = 2
    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(createError('Gateway', 504));
    // Erfolg
    mockApi.getBackupUploadsExportJob.mockResolvedValueOnce({ job: completedJob });

    const result = await waitForUploadsExportJobWithoutTimer(mockApi, 'job-123');
    expect(result).toEqual(completedJob);
    expect(mockApi.getBackupUploadsExportJob).toHaveBeenCalledTimes(5);
  });

  it('erkennt 502, 503, 429 Fehler als transient', async () => {
    const completedJob = { id: 'job-123', status: 'completed', totalFiles: 1, processedFiles: 1 };

    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(createError('Bad Gateway', 502));
    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(createError('Service Unavailable', 503));
    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(createError('Too Many Requests', 429));
    mockApi.getBackupUploadsExportJob.mockResolvedValueOnce({ job: completedJob });

    const result = await waitForUploadsExportJobWithoutTimer(mockApi, 'job-123');
    expect(result).toEqual(completedJob);
    expect(mockApi.getBackupUploadsExportJob).toHaveBeenCalledTimes(4);
  });

  it('erkennt Netzwerk-Fehler in Meldungen als transient', async () => {
    const completedJob = { id: 'job-123', status: 'completed', totalFiles: 1, processedFiles: 1 };

    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(
      new Error('Failed to fetch request'),
    );
    mockApi.getBackupUploadsExportJob.mockRejectedValueOnce(
      new Error('Request timed out'),
    );
    mockApi.getBackupUploadsExportJob.mockResolvedValueOnce({ job: completedJob });

    const result = await waitForUploadsExportJobWithoutTimer(mockApi, 'job-123');
    expect(result).toEqual(completedJob);
    expect(mockApi.getBackupUploadsExportJob).toHaveBeenCalledTimes(3);
  });
});

// -------- Hilfsfunktionen für Tests --------

function createError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Testbare Version von waitForUploadsExportJob (ohne Timer-Mocking)
 * Vereinfacht für Unit-Tests, keine echten Delays
 */
async function waitForUploadsExportJobWithoutTimer(api, jobId) {
  let consecutiveTransientErrors = 0;
  const maxRetries = 30;

  while (true) {
    let job;
    try {
      const result = await api.getBackupUploadsExportJob(jobId);
      job = result?.job;
      consecutiveTransientErrors = 0;
    } catch (err) {
      if (!isTransientExportStatusError(err)) {
        throw err;
      }

      consecutiveTransientErrors += 1;
      if (consecutiveTransientErrors >= maxRetries) {
        throw new Error(
          "Statusabfrage für Bild-Export mehrfach fehlgeschlagen (Gateway/Timeout). Bitte erneut versuchen.",
        );
      }

      // Kein echtes Delay in Tests
      continue;
    }

    if (job?.status === "completed") {
      return job;
    }

    if (job?.status === "failed") {
      throw new Error(buildUploadsExportErrorMessageTest(job.error));
    }

    // Kein echtes Delay in Tests
  }
}

function buildUploadsExportErrorMessageTest(error) {
  if (!error) return "Fehler beim Exportieren der Upload-Bilder";
  if (typeof error === "string") return error;

  return [
    error.message,
    error.fileName ? `Datei: ${error.fileName}` : null,
    error.cause ? `Ursache: ${error.cause}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}
