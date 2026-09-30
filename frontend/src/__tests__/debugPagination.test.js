import { debugSeitenInfo, hatVorherigeSeite, hatNaechsteSeite } from '../utils/debugPagination';

describe('debugPagination', () => {
  it('formatiert den Bereich der aktuellen Seite', () => {
    expect(debugSeitenInfo(0, 100, 250)).toBe('1–100 von 250');
    expect(debugSeitenInfo(200, 50, 250)).toBe('201–250 von 250');
  });

  it('zeigt bei leerer Tabelle 0 von 0', () => {
    expect(debugSeitenInfo(0, 0, 0)).toBe('0 von 0');
  });

  it('erkennt erste und letzte Seite', () => {
    expect(hatVorherigeSeite(0)).toBe(false);
    expect(hatVorherigeSeite(100)).toBe(true);
    expect(hatNaechsteSeite(0, 100, 250)).toBe(true);
    expect(hatNaechsteSeite(200, 50, 250)).toBe(false);
  });
});
