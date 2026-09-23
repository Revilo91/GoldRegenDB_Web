import { describe, it, expect } from 'vitest';
import { statusVon, statusBadge, istWahr, STATUS } from '../utils/status';

// Befund G22: die Status-Logik lag dreifach im Frontend und zeigte dabei
// unterschiedliche Badges für denselben Zustand -- "Lager" war einmal
// `badge gold` (Schmuckstuecke.jsx) und einmal `badge warning`
// (SchmuckstueckModal.jsx). Jetzt gibt es eine Quelle.
//
// Befund B6: "Verkauft"/"Ausschuss" sind in der Datenbank boolean. Der Helfer
// nimmt zusätzlich 0/1 und "1"/"0" an, damit ein älterer Aufrufer nicht
// stillschweigend den falschen Status bekommt.

describe('istWahr(wert)', () => {
  it('erkennt alle Schreibweisen von "gesetzt"', () => {
    expect(istWahr(true)).toBe(true);
    expect(istWahr(1)).toBe(true);
    expect(istWahr('1')).toBe(true);
    expect(istWahr('true')).toBe(true);
  });

  it('erkennt alle Schreibweisen von "nicht gesetzt"', () => {
    expect(istWahr(false)).toBe(false);
    expect(istWahr(0)).toBe(false);
    expect(istWahr('0')).toBe(false);
    expect(istWahr(null)).toBe(false);
    expect(istWahr(undefined)).toBe(false);
    expect(istWahr('')).toBe(false);
  });
});

describe('statusVon(stueck)', () => {
  it('erkennt Lager', () => {
    expect(statusVon({ Verkauft: false, Ausschuss: false, Ausgelagert: 0 }))
      .toBe(STATUS.LAGER);
  });

  it('erkennt Verkauft', () => {
    expect(statusVon({ Verkauft: true, Ausschuss: false, Ausgelagert: 0 }))
      .toBe(STATUS.VERKAUFT);
  });

  it('erkennt Ausschuss', () => {
    expect(statusVon({ Verkauft: false, Ausschuss: true, Ausgelagert: 0 }))
      .toBe(STATUS.AUSSCHUSS);
  });

  it('erkennt Ausgelagert', () => {
    expect(statusVon({ Verkauft: false, Ausschuss: false, Ausgelagert: 7 }))
      .toBe(STATUS.AUSGELAGERT);
  });

  // Der CHECK schmuck_status_chk verbietet diesen Zustand in der Datenbank.
  // Kommt er trotzdem an (Altdaten in einem Import), gewinnt Ausschuss -- so
  // wie in CLAUDE.md, wo "Ausschuss" allein über Ausschuss=1 definiert ist.
  it('gewichtet Ausschuss höher als Verkauft', () => {
    expect(statusVon({ Verkauft: true, Ausschuss: true, Ausgelagert: 3 }))
      .toBe(STATUS.AUSSCHUSS);
  });

  it('versteht auch die alte 0/1-Schreibweise', () => {
    expect(statusVon({ Verkauft: 1, Ausschuss: 0, Ausgelagert: 0 }))
      .toBe(STATUS.VERKAUFT);
    expect(statusVon({ Verkauft: 0, Ausschuss: 1, Ausgelagert: 0 }))
      .toBe(STATUS.AUSSCHUSS);
  });

  it('kommt mit fehlendem Stück zurecht', () => {
    expect(statusVon(null)).toBe(STATUS.LAGER);
    expect(statusVon(undefined)).toBe(STATUS.LAGER);
  });
});

describe('statusBadge(stueck, kundenName)', () => {
  it('liefert Label und CSS-Klasse', () => {
    expect(statusBadge({ Verkauft: true, Ausschuss: false, Ausgelagert: 0 }))
      .toEqual({ label: 'Verkauft', klasse: 'badge success' });
    expect(statusBadge({ Verkauft: false, Ausschuss: true, Ausgelagert: 0 }))
      .toEqual({ label: 'Ausschuss', klasse: 'badge danger' });
  });

  it('setzt für "Lager" überall dieselbe Klasse (G22)', () => {
    const badge = statusBadge({ Verkauft: false, Ausschuss: false, Ausgelagert: 0 });
    expect(badge).toEqual({ label: 'Lager', klasse: 'badge gold' });
  });

  it('löst Ausgelagert auf den Kundennamen auf, wenn möglich', () => {
    const badge = statusBadge(
      { Verkauft: false, Ausschuss: false, Ausgelagert: 4 },
      (id) => `Kunde ${id}`,
    );
    expect(badge).toEqual({ label: 'Kunde 4', klasse: 'badge gold' });
  });

  it('bleibt ohne Auflöser beim Wort "Ausgelagert"', () => {
    expect(statusBadge({ Verkauft: false, Ausschuss: false, Ausgelagert: 4 }).label)
      .toBe('Ausgelagert');
  });
});
