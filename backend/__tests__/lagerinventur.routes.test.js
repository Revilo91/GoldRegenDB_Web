const request = require('supertest');
const express = require('express');
const lagerinventurRoutes = require('../src/routes/lagerinventur');

// Mock-Auth-Middleware
const fakeAuth = (req, res, next) => {
  req.user = { id: 1, username: 'testuser', role: 'bearbeiter' };
  next();
};

// Mock-DB
jest.mock('../src/config/db', () => ({
  query: jest.fn(),
}));
const db = require('../src/config/db');

const app = express();
app.use(express.json());
app.use(fakeAuth);
app.use('/api/lagerinventur', lagerinventurRoutes);

describe('Lagerinventur-Entwurf API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('legt neuen Entwurf an', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, user_id: 1, data: { MBH001_1: 2 }, status: 'entwurf' }] });
    const res = await request(app)
      .post('/api/lagerinventur/drafts')
      .send({ data: { MBH001_1: 2 }, kommentar: 'Test' });
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('entwurf');
  });

  it('holt alle Entwürfe', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, user_id: 1, data: { MBH001_1: 2 }, status: 'entwurf' }] });
    const res = await request(app).get('/api/lagerinventur/drafts');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('aktualisiert Entwurf', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, user_id: 1, data: { MBH001_1: 3 }, status: 'entwurf' }] });
    const res = await request(app)
      .put('/api/lagerinventur/drafts/1')
      .send({ data: { MBH001_1: 3 }, kommentar: 'Update' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.MBH001_1).toBe(3);
  });

  it('schließt Entwurf ab', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, user_id: 1, status: 'abgeschlossen' }] });
    const res = await request(app).post('/api/lagerinventur/drafts/1/complete');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('abgeschlossen');
  });
});
