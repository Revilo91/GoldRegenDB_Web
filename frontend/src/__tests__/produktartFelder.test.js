import { produktartCodeVon, zeigtFeldgruppe } from '../utils/produktartFelder';

describe('produktartCodeVon', () => {
  it('nimmt den Code aus dem Formular, wenn er gesetzt ist', () => {
    expect(produktartCodeVon({ ProduktartCode: 'h', Artikelnummer: 'MHO123' })).toBe('H');
  });

  it('liest den Code sonst aus dem dritten Zeichen der Artikelnummer', () => {
    expect(produktartCodeVon({ Artikelnummer: 'MHO123_1' })).toBe('O');
  });

  it('liefert einen leeren Code ohne Angaben', () => {
    expect(produktartCodeVon({})).toBe('');
    expect(produktartCodeVon()).toBe('');
  });
});

describe('zeigtFeldgruppe', () => {
  it.each([
    ['A', 'laenge', true],
    ['A', 'zwischenstueck', true],
    ['A', 'anhaenger', false],
    ['H', 'laenge', true],
    ['H', 'zwischenstueck', true],
    ['H', 'anhaenger', true],
    ['O', 'laenge', true],
    ['O', 'zwischenstueck', false],
    ['O', 'anhaenger', false],
    ['S', 'laenge', false],
    ['S', 'zwischenstueck', false],
    ['S', 'anhaenger', true],
  ])('Produktart %s, Gruppe %s: %s', (code, gruppe, erwartet) => {
    expect(zeigtFeldgruppe(code, gruppe)).toBe(erwartet);
  });

  it('zeigt ohne oder mit unbekannter Produktart alle Gruppen', () => {
    expect(zeigtFeldgruppe('', 'anhaenger')).toBe(true);
    expect(zeigtFeldgruppe('Z', 'laenge')).toBe(true);
  });
});
