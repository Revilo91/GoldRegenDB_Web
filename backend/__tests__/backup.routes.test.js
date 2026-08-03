'use strict';

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  setCurrentDbUsername: jest.fn(),
  requestContextMiddleware: (req, res, next) => next(),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const AdmZip = require('adm-zip');

const UPLOADS_DIR = path.resolve(__dirname, '../.tmp-test-uploads');
const TEST_FILE_NAME = 'JEST_TEST_UPLOAD_IMAGE.png';
const TEST_FILE_PATH = path.join(UPLOADS_DIR, TEST_FILE_NAME);

process.env.BACKUP_UPLOADS_DIR = UPLOADS_DIR;
process.env.BACKUP_UPLOADS_ZIP_MAX_MB = '1';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // In der echten App ist /api/backup admin-geschützt. Für diese Route-Tests
  // injizieren wir einen Admin-Nutzer direkt.
  app.use((req, _res, next) => {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    next();
  });

  const backupRouter = require('../src/routes/backup');
  app.use('/api/backup', backupRouter);
  return app;
}

describe('backup uploads zip routes', () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(UPLOADS_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_FILE_PATH, { force: true });
  });

  it('POST /api/backup/import-uploads-zip returns 400 when no file is provided', async () => {
    const res = await request(app).post('/api/backup/import-uploads-zip');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ZIP-Datei/);
  });

  it('POST /api/backup/import-uploads-zip imports files from zip', async () => {
    const zip = new AdmZip();
    zip.addFile(TEST_FILE_NAME, Buffer.from('fake-image-content', 'utf8'));
    const zipBuffer = zip.toBuffer();

    const res = await request(app)
      .post('/api/backup/import-uploads-zip')
      .attach('uploadsZip', zipBuffer, {
        filename: 'uploads.zip',
        contentType: 'application/zip',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.uploads.restored).toBe(1);
    const written = await fs.readFile(TEST_FILE_PATH, 'utf8');
    expect(written).toBe('fake-image-content');
  });

  it('POST /api/backup/import-uploads-zip returns 413 with a clear message when the file exceeds the size limit', async () => {
    const oversizedBuffer = Buffer.alloc(2 * 1024 * 1024, 'x'); // 2MB > 1MB test limit

    const res = await request(app)
      .post('/api/backup/import-uploads-zip')
      .attach('uploadsZip', oversizedBuffer, {
        filename: 'too-big.zip',
        contentType: 'application/zip',
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/zu groß/);
  });

  it('GET /api/backup/export-uploads returns zip content', async () => {
    await fs.writeFile(TEST_FILE_PATH, 'fake-image-content');

    const res = await request(app)
      .get('/api/backup/export-uploads')
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('goldregendb_uploads_');

    const zip = new AdmZip(res.body);
    const entries = zip.getEntries().map((e) => e.entryName);
    expect(entries).toContain(TEST_FILE_NAME);
  });
});
