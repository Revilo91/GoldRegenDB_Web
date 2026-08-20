'use strict';

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const db = require('../src/config/db');
const auditLogRoutes = require('../src/routes/auditLog');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/audit-log', auditLogRoutes);
  return app;
}

describe('Audit-Log API', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it('liefert eine leere Liste kaputter Einträge bei intakter Hash-Kette', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/audit-log/verify');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ valid: true, brokenEntries: [] });
    expect(db.query).toHaveBeenCalledWith('SELECT id, problem FROM verify_audit_chain()');
  });

  it('meldet manipulierte Einträge, wenn verify_audit_chain() Treffer liefert', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 3, problem: 'hash_mismatch' },
        { id: 7, problem: 'chain_broken' },
      ],
    });
    const res = await request(app).get('/api/audit-log/verify');
    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.brokenEntries).toHaveLength(2);
    expect(res.body.brokenEntries[0]).toEqual({ id: 3, problem: 'hash_mismatch' });
  });

  it('gibt 500 zurück, wenn die Verifikation fehlschlägt', async () => {
    db.query.mockRejectedValueOnce(new Error('DB kaputt'));
    const res = await request(app).get('/api/audit-log/verify');
    expect(res.statusCode).toBe(500);
  });

  it('liefert paginierte Audit-Log-Einträge', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, table_name: 'Schmuckstück', hash: 'abc' }] });
    const res = await request(app).get('/api/audit-log');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it('liefert das Audit-Log für ein einzelnes Artikel', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, artikelnummer_id: 'A1' }] });
    const res = await request(app).get('/api/audit-log/artikel/A1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
