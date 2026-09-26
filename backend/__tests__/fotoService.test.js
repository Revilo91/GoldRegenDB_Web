'use strict';

const {
  MAX_FOTO_BYTES,
  FotoFehler,
  erkenneBildtyp,
  pruefeBild,
  basisArtikelnummer,
  leseDataUrl,
  speichereFoto,
  sendeFoto,
} = require('../src/utils/fotoService');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = Buffer.from('GIF89a\x01\x00', 'latin1');

describe('erkenneBildtyp – Magic Bytes', () => {
  test.each([
    [JPEG, 'image/jpeg'],
    [PNG, 'image/png'],
    [GIF, 'image/gif'],
    [Buffer.from('GIF87a\x01\x00', 'latin1'), 'image/gif'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), null],
    [Buffer.from('%PDF-1.7 ...'), null],
    [Buffer.from([0xff, 0xd8]), null],
  ])('%#: erkennt %s', (buffer, erwartet) => {
    expect(erkenneBildtyp(buffer)).toBe(erwartet);
  });
});

describe('pruefeBild – Grenzwerte', () => {
  const jpegMitGroesse = (bytes) => Buffer.concat([JPEG, Buffer.alloc(bytes - JPEG.length)]);

  it('akzeptiert genau 5 MB', () => {
    expect(pruefeBild(jpegMitGroesse(MAX_FOTO_BYTES))).toBe('image/jpeg');
  });

  it('lehnt 5 MB + 1 Byte ab', () => {
    expect(() => pruefeBild(jpegMitGroesse(MAX_FOTO_BYTES + 1))).toThrow(FotoFehler);
  });

  it('lehnt leere Daten ab', () => {
    expect(() => pruefeBild(Buffer.alloc(0))).toThrow('Keine Bilddaten');
  });

  it('lehnt als JPG getarnten Text ab', () => {
    expect(() => pruefeBild(Buffer.from('kein bild, nur text'))).toThrow(
      'Nur JPG, PNG und GIF Dateien sind erlaubt',
    );
  });
});

describe('basisArtikelnummer', () => {
  test.each([
    ['MHO123', 'MHO123'],
    ['MHO123_2', 'MHO123'],
    ['MHO123.jpg', 'MHO123'],
    ['MHO123_1.png', 'MHO123'],
    ['ordner/MHO123.jpg', 'MHO123'],
    ['../../etc/passwd', 'PASSWD'],
    ['mho123', 'MHO123'],
    ['', null],
    [undefined, null],
    ['A'.repeat(21), null],
  ])('%s → %s', (eingabe, erwartet) => {
    expect(basisArtikelnummer(eingabe)).toBe(erwartet);
  });
});

describe('leseDataUrl', () => {
  it('liefert Buffer und erkannten Typ', () => {
    const { buffer, mimeType } = leseDataUrl(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(buffer.equals(PNG)).toBe(true);
    expect(mimeType).toBe('image/png');
  });

  it('verlässt sich nicht auf den deklarierten Typ', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    expect(() => leseDataUrl(`data:image/png;base64,${svg}`)).toThrow(FotoFehler);
  });

  it('lehnt andere Formate ab', () => {
    expect(() => leseDataUrl('data:image/svg+xml;base64,AAAA')).toThrow(
      'Foto muss als JPG-, PNG- oder GIF-Bild übermittelt werden',
    );
  });
});

describe('speichereFoto', () => {
  it('schreibt per Upsert mit Größe und erkanntem Typ', async () => {
    const queryable = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };

    await speichereFoto(queryable, 'schmuckstueck', 'MHO123', PNG);

    const [sql, params] = queryable.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO "Foto"/);
    expect(sql).toMatch(/ON CONFLICT \("Artikelnummer"\) DO UPDATE/);
    expect(params).toEqual(['MHO123', PNG, 'image/png', PNG.length]);
  });

  it('schreibt nichts bei ungültigen Bilddaten', async () => {
    const queryable = { query: jest.fn() };

    await expect(speichereFoto(queryable, 'bestellung', 'x', Buffer.from('nope!!'))).rejects.toThrow(FotoFehler);
    expect(queryable.query).not.toHaveBeenCalled();
  });
});

describe('sendeFoto – ETag', () => {
  function antwort() {
    const res = { headers: {} };
    res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
    res.status = jest.fn(() => res);
    res.type = jest.fn(() => res);
    res.send = jest.fn(() => res);
    res.end = jest.fn(() => res);
    return res;
  }
  const anfrage = (ifNoneMatch) => ({ get: () => ifNoneMatch });
  const mitZeile = (zeile) => ({ query: jest.fn().mockResolvedValue({ rows: [zeile] }) });

  it('liefert Daten mit ETag und Content-Type', async () => {
    const queryable = mitZeile({ mimeType: 'image/png', version: '42', daten: PNG });
    const res = antwort();

    expect(await sendeFoto(anfrage(undefined), res, queryable, 'schmuckstueck', 'MHO123')).toBe(true);

    expect(queryable.query.mock.calls[0][1]).toEqual(['MHO123', null]);
    expect(res.headers.ETag).toBe('"42"');
    expect(res.type).toHaveBeenCalledWith('image/png');
    expect(res.send).toHaveBeenCalledWith(PNG);
  });

  it('antwortet 304, wenn der ETag passt (Daten kommen dann nicht aus der DB)', async () => {
    const queryable = mitZeile({ mimeType: 'image/png', version: '42', daten: null });
    const res = antwort();

    await sendeFoto(anfrage('W/"42"'), res, queryable, 'schmuckstueck', 'MHO123');

    expect(queryable.query.mock.calls[0][1]).toEqual(['MHO123', '42']);
    expect(res.status).toHaveBeenCalledWith(304);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('gibt false zurück, wenn es kein Foto gibt', async () => {
    const queryable = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    expect(await sendeFoto(anfrage(), antwort(), queryable, 'bestellung', 'abc')).toBe(false);
  });
});
