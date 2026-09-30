'use strict';

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
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
const logger = require('../src/utils/logger');
const debugRoutes = require('../src/routes/debug');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/debug', debugRoutes);
  return app;
}

const COLUMNS = [
  { column_name: 'id', data_type: 'integer' },
  { column_name: 'name', data_type: 'text' },
  { column_name: 'bild', data_type: 'bytea' },
];

// Antwortet je nach SQL-Text; Reihenfolge der Aufrufe ist damit egal
function mockDb({ columns = COLUMNS, pk = ['id'], total = 250 } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (sql.includes('information_schema.columns')) return { rows: columns };
    if (sql.includes('pg_index')) return { rows: pk.map((column_name) => ({ column_name })) };
    if (sql.includes('COUNT(*)')) return { rows: [{ total }] };
    if (sql.includes('information_schema.tables')) {
      return { rows: ['app_users', 'audit_log', 'bestellung', 'bestellung_foto', 'schema_migrations', 'Foto', 'kunden'].map((table_name) => ({ table_name })) };
    }
    return { rows: [{ id: 1, name: 'x' }] };
  });
}

function mockClient({ oldRows = [{ value: 'alt' }], updated = [{ id: 1, name: 'neu' }] } = {}) {
  const client = {
    query: jest.fn(async (sql) => {
      if (sql.startsWith('SELECT')) return { rows: oldRows };
      if (sql.startsWith('UPDATE')) return { rows: updated };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  db.connect.mockResolvedValue(client);
  return client;
}

describe('Debug-Route (#262)', () => {
  let app;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.DEBUG_ROUTE_ENABLED = 'true';
    app = buildApp();
    mockDb();
  });

  afterAll(() => {
    delete process.env.DEBUG_ROUTE_ENABLED;
  });

  describe('Abschalter', () => {
    it.each([undefined, 'false', '1'])('antwortet 404, wenn DEBUG_ROUTE_ENABLED=%s', async (wert) => {
      if (wert === undefined) delete process.env.DEBUG_ROUTE_ENABLED;
      else process.env.DEBUG_ROUTE_ENABLED = wert;
      expect((await request(app).get('/api/debug/tables')).statusCode).toBe(404);
      expect((await request(app).get('/api/debug/tables/kunden')).statusCode).toBe(404);
      expect((await request(app).put('/api/debug/tables/kunden').send({})).statusCode).toBe(404);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('Blocklist', () => {
    it.each(['app_users', 'audit_log', 'bestellung', 'bestellung_foto', 'schema_migrations', 'Bestellung_X'])(
      'GET und PUT auf %s liefern 403',
      async (tabelle) => {
        expect((await request(app).get(`/api/debug/tables/${tabelle}`)).statusCode).toBe(403);
        const put = await request(app).put(`/api/debug/tables/${tabelle}`).send({ primaryKey: 'id', id: 1, field: 'x', value: 'y' });
        expect(put.statusCode).toBe(403);
        expect(db.query).not.toHaveBeenCalled();
        expect(db.connect).not.toHaveBeenCalled();
      }
    );

    it('blendet gesperrte Tabellen in der Liste aus', async () => {
      const res = await request(app).get('/api/debug/tables');
      expect(res.body).toEqual(['Foto', 'kunden']);
    });
  });

  describe('GET /tables/:name', () => {
    it('nutzt Default-Seitengröße 100, liefert total/limit/offset und sortiert nach PK', async () => {
      const res = await request(app).get('/api/debug/tables/kunden');
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ total: 250, limit: 100, offset: 0, primaryKeys: ['id'] });
      const dataCall = db.query.mock.calls.find(([sql]) => sql.includes('LIMIT'));
      expect(dataCall[0]).toContain('ORDER BY "id"');
      expect(dataCall[1]).toEqual([100, 0]);
    });

    it('kappt limit auf 500 und übernimmt offset', async () => {
      const res = await request(app).get('/api/debug/tables/kunden?limit=9999&offset=200');
      expect(res.body).toMatchObject({ limit: 500, offset: 200 });
    });

    it.each(['limit=0', 'limit=-1', 'limit=abc', 'offset=-5', 'offset=1.5', 'limit=1&limit=2'])(
      'lehnt %s mit 400 ab',
      async (qs) => {
        const res = await request(app).get(`/api/debug/tables/kunden?${qs}`);
        expect(res.statusCode).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
      }
    );

    it('liefert nie BYTEA-Spalten (weder in Select noch in columns)', async () => {
      const res = await request(app).get('/api/debug/tables/Foto');
      const dataCall = db.query.mock.calls.find(([sql]) => sql.includes('LIMIT'));
      expect(dataCall[0]).toContain('SELECT "id", "name" FROM');
      expect(dataCall[0]).not.toContain('bild');
      expect(dataCall[0]).not.toContain('*');
      expect(res.body.columns.map((c) => c.column_name)).toEqual(['id', 'name']);
    });

    it('antwortet 404 bei unbekannter Tabelle', async () => {
      mockDb({ columns: [] });
      expect((await request(app).get('/api/debug/tables/gibtsnicht')).statusCode).toBe(404);
    });

    it('antwortet 400 bei ungültigem Tabellennamen', async () => {
      expect((await request(app).get('/api/debug/tables/a-b')).statusCode).toBe(400);
    });
  });

  describe('PUT /tables/:name', () => {
    const body = { primaryKey: 'id', id: 1, field: 'name', value: 'neu' };

    it.each([
      ['unbekannte Spalte', { ...body, field: 'gibtsnicht' }],
      ['BYTEA-Spalte', { ...body, field: 'bild' }],
      ['falscher Primärschlüssel', { ...body, primaryKey: 'name' }],
      ['PK-Feld selbst', { ...body, field: 'id' }],
    ])('lehnt %s mit 400 ab', async (_titel, payload) => {
      const res = await request(app).put('/api/debug/tables/kunden').send(payload);
      expect(res.statusCode).toBe(400);
      expect(db.connect).not.toHaveBeenCalled();
    });

    it('lehnt Tabellen ohne einspaltigen PK mit 400 ab', async () => {
      mockDb({ pk: [] });
      expect((await request(app).put('/api/debug/tables/kunden').send(body)).statusCode).toBe(400);
      mockDb({ pk: ['id', 'name'] });
      expect((await request(app).put('/api/debug/tables/kunden').send(body)).statusCode).toBe(400);
    });

    it('aktualisiert in Transaktion mit FOR UPDATE und loggt alt/neu', async () => {
      const client = mockClient();
      const res = await request(app).put('/api/debug/tables/kunden').send(body);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ id: 1, name: 'neu' });
      const sqls = client.query.mock.calls.map(([sql]) => sql);
      expect(sqls[0]).toBe('BEGIN');
      expect(sqls[1]).toContain('FOR UPDATE');
      expect(sqls[2]).toContain('UPDATE "kunden" SET "name" = $1');
      expect(sqls[2]).not.toContain('bild');
      expect(sqls[3]).toBe('COMMIT');
      expect(client.release).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('DEBUG', 'Debug-Update', {
        benutzer: 'admin',
        tabelle: 'kunden',
        feld: 'name',
        pkWert: '1',
        alterWert: 'alt',
        neuerWert: 'neu',
      });
    });

    it('kürzt lange Werte im Log auf 200 Zeichen', async () => {
      mockClient({ oldRows: [{ value: 'a'.repeat(500) }] });
      await request(app).put('/api/debug/tables/kunden').send(body);
      const meta = logger.info.mock.calls[0][2];
      expect(meta.alterWert.length).toBeLessThanOrEqual(201);
    });

    it('antwortet 404 und rollt zurück, wenn die Zeile fehlt', async () => {
      const client = mockClient({ oldRows: [] });
      const res = await request(app).put('/api/debug/tables/kunden').send(body);
      expect(res.statusCode).toBe(404);
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
