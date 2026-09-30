'use strict';

const { artikelnummerBasis, artikelKategorie, artikelBezeichnung } = require('../src/utils/artikelBezeichnung');

describe('artikelnummerBasis', () => {
  it('schneidet das Exemplar-Suffix ab', () => {
    expect(artikelnummerBasis('MHO123_2')).toBe('MHO123');
  });

  it('lässt Nummern ohne Suffix unverändert', () => {
    expect(artikelnummerBasis('MHO123')).toBe('MHO123');
  });

  it.each([[undefined], [null], ['']])('liefert bei %p einen leeren String', (wert) => {
    expect(artikelnummerBasis(wert)).toBe('');
  });
});

describe('artikelKategorie', () => {
  it('leitet das Material aus dem zweiten Buchstaben ab', () => {
    expect(artikelKategorie({ Artikelnummer: 'MHO123_1' })).toBe('Harz');
    expect(artikelKategorie({ Artikelnummer: 'MBA234_2' })).toBe('Beton');
  });

  it('fällt bei unbekanntem Kürzel auf das Feld Art zurück', () => {
    expect(artikelKategorie({ Artikelnummer: 'MZO123', Art: 'Sonstiges' })).toBe('Sonstiges');
  });

  it('liefert einen leeren String ohne Kürzel und ohne Art', () => {
    expect(artikelKategorie({})).toBe('');
  });
});

describe('artikelBezeichnung', () => {
  it('bevorzugt den Namen, wenn gesetzt', () => {
    expect(artikelBezeichnung({ Artikelnummer: 'MHO1', Name: 'Sonnenblume' })).toBe('Ohrring: Sonnenblume');
  });

  it('ignoriert einen Namen aus Leerzeichen', () => {
    expect(artikelBezeichnung({ Artikelnummer: 'MHO1', Name: '   ', Art: 'Stecker' })).toMatch(/^Ohrring: Stecker /);
  });

  it('beschreibt Ohrringe ohne Name aus Art, Form, Fassung, Farbe und Zusatzmaterial', () => {
    const text = artikelBezeichnung({
      Artikelnummer: 'MHO123_1', Art: 'Stecker', Form: 'rund', Fassung: 'Silber', Farbe: 'rot', Inhalt_Zusatzmaterial: 'Gold',
    });
    expect(text).toBe('Ohrring: Stecker rund Silber rot, Gold');
  });

  it('ersetzt fehlende Werte, "0" und 0 durch einen Strich', () => {
    const text = artikelBezeichnung({ Artikelnummer: 'MHO123_1', Art: '0', Form: 0, Fassung: null });
    expect(text).toBe('Ohrring: - - - -, -');
  });

  it('beschreibt Halsketten über die Anhänger-Felder', () => {
    const text = artikelBezeichnung({
      Artikelnummer: 'MBH001', Anhänger_Fassung: 'Silber', Anhänger_Form: 'Tropfen', Anhänger_Inhalt_Farbe: 'blau', Anhänger_Inhalt_Zusatzmaterial: 'Glitzer',
    });
    expect(text).toBe('Halskette: Fassung Silber Tropfen, blau Glitzer');
  });

  it('beschreibt Armbänder', () => {
    const text = artikelBezeichnung({
      Artikelnummer: 'MBA001', Art: 'Makramee', Farbe: 'grün', Anhänger: 'Stern', Zwischenstück: 'Perle',
    });
    expect(text).toBe('Armband: Makramee grün, Stern, Perle');
  });

  it('beschreibt Schlüsselanhänger', () => {
    expect(artikelBezeichnung({ Artikelnummer: 'MBS001', Art: 'Beton', Form: 'Herz' })).toBe('Schlüsselanhänger: Beton Herz');
  });

  it('nutzt für unbekannte Produktarten das Fallback-Format', () => {
    expect(artikelBezeichnung({ Artikelnummer: 'MBX001', Art: 'Deko', Material: 'Holz', Farbe: 'braun' })).toBe('Deko: Holz braun');
  });

  it('liefert für ein leeres Objekt das Fallback-Format ohne Fehler', () => {
    expect(artikelBezeichnung({})).toBe(':  ');
  });
});
