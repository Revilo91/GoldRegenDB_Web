import { ANSICHT, leseAnsicht, schreibeAnsicht } from '../utils/ansichtSpeicher';

const SCHLUESSEL = 'schmuckstuecke-ansicht';

describe('ansichtSpeicher', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('kennt Liste, Tabelle und Raster', () => {
    expect(ANSICHT).toEqual({ LISTE: 'liste', TABELLE: 'tabelle', RASTER: 'raster' });
  });

  it('liefert null, wenn nichts gespeichert ist (den Standard bestimmt die Seite)', () => {
    expect(leseAnsicht()).toBeNull();
  });

  it.each(['liste', 'tabelle', 'raster'])('liest den gespeicherten Wert "%s"', (wert) => {
    localStorage.setItem(SCHLUESSEL, wert);
    expect(leseAnsicht()).toBe(wert);
  });

  it('liefert null bei einem ungültigen gespeicherten Wert', () => {
    localStorage.setItem(SCHLUESSEL, 'quatsch');
    expect(leseAnsicht()).toBeNull();
  });

  it('liefert null, wenn localStorage wirft', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('gesperrt'); });
    expect(leseAnsicht()).toBeNull();
  });

  it('speichert die Wahl und schluckt Fehler beim Schreiben', () => {
    schreibeAnsicht(ANSICHT.LISTE);
    expect(localStorage.getItem(SCHLUESSEL)).toBe('liste');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('gesperrt'); });
    expect(() => schreibeAnsicht(ANSICHT.RASTER)).not.toThrow();
  });
});
