import { naechsteVorlagenNummer } from '../utils/artikelnummer';

describe('naechsteVorlagenNummer', () => {
  it('nimmt im Normalfall die Nummer des Servers und hängt _1 an', () => {
    expect(naechsteVorlagenNummer('MHO', 'MHO127', [])).toBe('MHO127_1');
  });

  it('zählt bei einer zweiten Zeile mit gleichem Präfix hoch', () => {
    const rows = [{ Artikelnummer: 'MHO127_1' }];
    expect(naechsteVorlagenNummer('MHO', 'MHO127', rows)).toBe('MHO128_1');
  });

  it('zählt hinter der höchsten lokal vergebenen Nummer weiter', () => {
    const rows = [{ Artikelnummer: 'MHO128_1' }, { Artikelnummer: 'MHO127_2' }];
    expect(naechsteVorlagenNummer('MHO', 'MHO127', rows)).toBe('MHO129_1');
  });

  it('lässt andere Präfixe unberührt', () => {
    const rows = [{ Artikelnummer: 'MBA900_1' }, { Artikelnummer: 'SHO500_1' }];
    expect(naechsteVorlagenNummer('MHO', 'MHO127', rows)).toBe('MHO127_1');
  });

  it('ignoriert leere und ungültige Zeilen', () => {
    const rows = [
      { Artikelnummer: '' },
      { Artikelnummer: undefined },
      { Artikelnummer: 'MHO' },
      { Artikelnummer: 'MHO9999_1' },
      { Artikelnummer: 'mho12x_1' },
      {},
    ];
    expect(naechsteVorlagenNummer('MHO', 'MHO127', rows)).toBe('MHO127_1');
  });

  it('erkennt Nummern ohne Suffix und in Kleinschreibung', () => {
    const rows = [{ Artikelnummer: ' mho130 ' }];
    expect(naechsteVorlagenNummer('MHO', 'MHO127', rows)).toBe('MHO131_1');
  });

  it('nimmt den Serverwert, wenn er höher als lokal ist', () => {
    const rows = [{ Artikelnummer: 'MHO050_1' }];
    expect(naechsteVorlagenNummer('MHO', 'MHO127', rows)).toBe('MHO127_1');
  });

  it('füllt kleine Nummern dreistellig mit Nullen auf', () => {
    expect(naechsteVorlagenNummer('MHO', 'MHO007', [])).toBe('MHO007_1');
    expect(naechsteVorlagenNummer('MHO', 'MHO007', [{ Artikelnummer: 'MHO007_1' }])).toBe('MHO008_1');
  });

  it('liefert einen leeren String bei ungültigem Präfix oder Serverwert', () => {
    expect(naechsteVorlagenNummer('MH', 'MHO127', [])).toBe('');
    expect(naechsteVorlagenNummer('MHO', undefined, [])).toBe('');
    expect(naechsteVorlagenNummer('MHO', 'SHO127', [])).toBe('');
    expect(naechsteVorlagenNummer('MHO', 'MHO1000', [])).toBe('');
    expect(naechsteVorlagenNummer('MHO', {}, [])).toBe('');
  });

  it('liefert einen leeren String, wenn die Laufnummer 999 überschreiten würde', () => {
    expect(naechsteVorlagenNummer('MHO', 'MHO999', [])).toBe('MHO999_1');
    expect(naechsteVorlagenNummer('MHO', 'MHO999', [{ Artikelnummer: 'MHO999_1' }])).toBe('');
  });
});
