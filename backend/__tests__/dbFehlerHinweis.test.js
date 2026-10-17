'use strict';

const { dbFehlerHinweis } = require('../src/utils/dbFehlerHinweis');

describe('dbFehlerHinweis', () => {
  it('liefert bei Passwortfehler (28P01) einen Hinweis mit Ursache und Lösung', () => {
    const hinweis = dbFehlerHinweis({ code: '28P01' });

    expect(hinweis).toContain('POSTGRES_PASSWORD');
    expect(hinweis).toContain('pgdata_dev');
    expect(hinweis).toContain('ALTER ROLE');
  });

  it('liefert keinen Hinweis bei anderen Fehlern', () => {
    expect(dbFehlerHinweis({ code: 'ECONNREFUSED' })).toBeNull();
    expect(dbFehlerHinweis(new Error('irgendwas'))).toBeNull();
  });

  it('verkraftet fehlende oder leere Fehlerobjekte', () => {
    expect(dbFehlerHinweis(undefined)).toBeNull();
    expect(dbFehlerHinweis(null)).toBeNull();
  });
});
