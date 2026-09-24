const request = require('supertest');
const express = require('express');

jest.mock('../src/config/db', () => ({ query: jest.fn() }));
// Echte QR-Erzeugung ist unter Jest sehr langsam und für diese Tests irrelevant
jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,QRSTUB'),
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const db = require('../src/config/db');
const etikettenRoutes = require('../src/routes/etiketten');

const fakeAuth = (req, res, next) => {
  req.user = { id: 1, username: 'testuser', role: 'bearbeiter' };
  next();
};

const app = express();
app.use(express.json());
app.use(fakeAuth);
app.use('/api/etiketten', etikettenRoutes);

const schmuckstueckRow = (artikelnummer) => ({
  rows: [{ Artikelnummer: artikelnummer, Name: 'Testkette' }],
});

describe('Etiketten API', () => {
  beforeEach(() => db.query.mockReset());

  describe('GET /sizes', () => {
    it('liefert alle Etikettengrößen mit Maßen und Standardgröße', async () => {
      const res = await request(app).get('/api/etiketten/sizes');

      expect(res.statusCode).toBe(200);
      expect(res.body.defaultSize).toBe('small');
      expect(res.body.sizes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'small', w: 30, h: 20, showQr: false }),
          expect.objectContaining({ id: 'large', w: 40, h: 30, showQr: true }),
        ]),
      );
    });
  });

  describe('POST /preview', () => {
    it('erzeugt je Stückzahl ein Etikett im Druckmodus', async () => {
      db.query.mockResolvedValueOnce(schmuckstueckRow('MBH001_1'));

      const res = await request(app)
        .post('/api/etiketten/preview')
        .send({ items: [{ artikelnummer: 'MBH001', qty: 3 }], labelSize: 'small' });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('mode-print');
      expect((res.text.match(/class="label"/g) || []).length).toBe(3);
      // Basis-Artikelnummer ohne Positionssuffix
      expect(res.text).toContain('>MBH001<');
    });

    it('liefert im Einzelmodus genau ein Etikett mit Vorschau-Skript', async () => {
      db.query.mockResolvedValueOnce(schmuckstueckRow('MBH001_1'));

      const res = await request(app)
        .post('/api/etiketten/preview')
        .send({
          items: [{ artikelnummer: 'MBH001', qty: 5 }],
          labelSize: 'small',
          mode: 'single',
        });

      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('mode-single');
      expect((res.text.match(/class="label"/g) || []).length).toBe(1);
      expect(res.text).toContain('etikett-size-mode');
    });

    it('zeigt im Einzelmodus ohne Artikel ein Musteretikett', async () => {
      const res = await request(app)
        .post('/api/etiketten/preview')
        .send({ items: [], mode: 'single', labelSize: 'small' });

      expect(res.statusCode).toBe(200);
      expect(res.text).toContain('GR12345');
      expect(db.query).not.toHaveBeenCalled();
    });

    it('setzt @page und Inhaltsbox auf die Maße der gewählten Größe', async () => {
      db.query.mockResolvedValueOnce(schmuckstueckRow('MBH001_1'));

      const res = await request(app)
        .post('/api/etiketten/preview')
        .send({ items: [{ artikelnummer: 'MBH001', qty: 1 }], labelSize: 'large' });

      expect(res.text).toContain('size: 40mm 45mm');
      expect(res.text).toContain('--label-real-h: 30mm');
      // large wird gedreht gedruckt: Inhaltsbox ist hochkant
      expect(res.text).toContain('--content-w: 30mm');
      expect(res.text).toContain('--content-h: 40mm');
      expect(res.text).toContain('label label--rotated');
    });

    it('setzt die Symbolgröße der gewählten Größe', async () => {
      db.query.mockResolvedValueOnce(schmuckstueckRow('MBH001_1'));

      const gross = await request(app)
        .post('/api/etiketten/preview')
        .send({ items: [{ artikelnummer: 'MBH001', qty: 1 }], labelSize: 'large' });

      db.query.mockResolvedValueOnce(schmuckstueckRow('MBH001_1'));
      const klein = await request(app)
        .post('/api/etiketten/preview')
        .send({ items: [{ artikelnummer: 'MBH001', qty: 1 }], labelSize: 'small' });

      expect(gross.text).toContain('--icon-size: 12mm');
      expect(klein.text).toContain('--icon-size: 6mm');
    });

    it('erzeugt nur so viele Hinweiszeilen wie nötig', async () => {
      db.query.mockResolvedValueOnce(schmuckstueckRow('MBH001_1'));

      const res = await request(app)
        .post('/api/etiketten/preview')
        .send({
          items: [{ artikelnummer: 'MBH001', qty: 1 }],
          materialHints: ['A', 'B'],
          labelSize: 'small',
        });

      expect(res.text.match(/<tr>/g)).toHaveLength(1);
      expect(res.text).toContain('<td>A</td><td>B</td>');
    });

    it('nutzt bei unbekannter Größe die Standardgröße', async () => {
      db.query.mockResolvedValueOnce(schmuckstueckRow('MBH001_1'));

      const res = await request(app)
        .post('/api/etiketten/preview')
        .send({ items: [{ artikelnummer: 'MBH001', qty: 1 }], labelSize: 'gibtsnicht' });

      expect(res.text).toContain('size: 30mm 20mm');
    });

    it('begrenzt Materialhinweise auf sechs Einträge und entfernt Duplikate', async () => {
      db.query.mockResolvedValueOnce(schmuckstueckRow('MBH001_1'));

      const res = await request(app)
        .post('/api/etiketten/preview')
        .send({
          items: [{ artikelnummer: 'MBH001', qty: 1 }],
          materialHints: ['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'],
          labelSize: 'large',
        });

      expect(res.text).toContain('<td>F</td>');
      expect(res.text).not.toContain('<td>G</td>');
    });

    it('maskiert HTML in Materialhinweisen', async () => {
      db.query.mockResolvedValueOnce(schmuckstueckRow('MBH001_1'));

      const res = await request(app)
        .post('/api/etiketten/preview')
        .send({
          items: [{ artikelnummer: 'MBH001', qty: 1 }],
          materialHints: ['<script>x</script>'],
          labelSize: 'large',
        });

      expect(res.text).not.toContain('<script>x</script>');
      expect(res.text).toContain('&lt;script&gt;');
    });

    it('lehnt den Druckmodus ohne Artikel ab', async () => {
      const res = await request(app).post('/api/etiketten/preview').send({ items: [] });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Keine Artikel übergeben');
    });

    it('meldet 404, wenn keine Artikelnummer gefunden wurde', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/etiketten/preview')
        .send({ items: [{ artikelnummer: 'UNBEKANNT', qty: 1 }] });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /options', () => {
    it('liefert eindeutige Basis-Artikelnummern', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ artikel_base: 'MBH001', name: 'Testkette' }],
      });

      const res = await request(app).get('/api/etiketten/options?q=MBH');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual([{ artikelnummer: 'MBH001', name: 'Testkette' }]);
    });
  });
});
