import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import Inventur from '../pages/Inventur';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getInventur: vi.fn(),
    getInventurKunde: vi.fn(),
    exportInventurExcel: vi.fn(),
    restockKundeSelective: vi.fn(),
    createRechnung: vi.fn(),
    getInventurDrafts: vi.fn(),
    getInventurDraft: vi.fn(),
    createInventurDraft: vi.fn(),
    updateInventurDraft: vi.fn(),
    completeInventurDraft: vi.fn(),
    getInventurDiff: vi.fn(),
    getUniqueArtikelnummern: vi.fn(),
  },
}));

vi.mock('../components/TablePhoto', () => ({ default: () => null }));
vi.mock('../components/SchmuckstueckModal', () => ({ default: () => null }));

const kunden = [
  { ID: 1, Name: 'Anna Laden', Ort: 'Köln', Aktiv: true, gesamt: 5, aktiv: 3, verkauft: 1, ausschuss: 1, wert_aktiv: '30.50', wert_verkauft: '10.00' },
  { ID: 2, Name: 'Bernd Markt', Ort: 'Bonn', Aktiv: true, gesamt: 2, aktiv: 2, verkauft: 0, ausschuss: 0, wert_aktiv: '20.00', wert_verkauft: '0' },
  { ID: 3, Name: 'Alt Kunde', Ort: 'Essen', Aktiv: false, gesamt: 1, aktiv: 1, verkauft: 0, ausschuss: 0, wert_aktiv: '5.00', wert_verkauft: '0' },
];

const detail = {
  stats: { gesamt: 4, aktiv: 2, verkauft: 1, ausschuss: 1, wert_aktiv: '25.00', wert_verkauft: '12.00' },
  items: [
    { Artikelnummer: 'MHO001_1', Verkaufspreis: '10.00', Verkauft: 0, Ausschuss: 0 },
    { Artikelnummer: 'MHO002_1', Verkaufspreis: '15.00', Verkauft: 0, Ausschuss: 0 },
    { Artikelnummer: 'SBA003_1', Verkaufspreis: '12.00', Verkauft: 1, Ausschuss: 0 },
    { Artikelnummer: 'SBA004_1', Verkaufspreis: '3.00', Verkauft: 0, Ausschuss: 1 },
  ],
};

const eur = (zahl) => new RegExp(`^${zahl}\\s€$`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  api.getInventur.mockResolvedValue(kunden);
  api.getInventurKunde.mockResolvedValue(detail);
  api.getInventurDrafts.mockResolvedValue([]);
  api.getUniqueArtikelnummern.mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

describe('Kunden-Inventur (Abgleich)', () => {
  it('listet nur aktive Kunden und summiert Stückzahlen und Warenwerte der geladenen Zeilen', async () => {
    rendereMitToast(<Inventur />);

    expect(await screen.findByText('Anna Laden')).toBeInTheDocument();
    expect(screen.getByText('Bernd Markt')).toBeInTheDocument();
    expect(screen.queryByText('Alt Kunde')).not.toBeInTheDocument();
    const summe = screen.getByText('Gesamt', { selector: 'td' }).closest('tr');
    // Fußzeile summiert über alle Kunden aus der API (auch inaktive): 5+2+1 gesamt, 3+2+1 aktiv
    expect(within(summe).getByText('8')).toBeInTheDocument();
    expect(within(summe).getByText('6')).toBeInTheDocument();
    expect(within(summe).getByText(eur('55,50'))).toBeInTheDocument();
    expect(within(summe).getByText(eur('10,00'))).toBeInTheDocument();
  });

  it('zeigt alle Kunden inklusive Inaktiver, wenn der Statusfilter geleert wird', async () => {
    rendereMitToast(<Inventur />);
    await screen.findByText('Anna Laden');

    fireEvent.change(screen.getByDisplayValue('Aktiv'), { target: { value: '' } });

    expect(screen.getByText('Alt Kunde')).toBeInTheDocument();
    expect(screen.getByText('Inaktiv', { selector: 'span' })).toBeInTheDocument();
  });

  it('filtert per Suche nach Name und Ort, Groß-/Kleinschreibung egal', async () => {
    rendereMitToast(<Inventur />);
    await screen.findByText('Anna Laden');

    fireEvent.change(screen.getByPlaceholderText(/Suche nach Kunde/), { target: { value: 'bonn' } });

    expect(screen.getByText('Bernd Markt')).toBeInTheDocument();
    expect(screen.queryByText('Anna Laden')).not.toBeInTheDocument();
  });

  it('meldet, wenn die Suche nichts findet', async () => {
    rendereMitToast(<Inventur />);
    await screen.findByText('Anna Laden');

    fireEvent.change(screen.getByPlaceholderText(/Suche nach Kunde/), { target: { value: 'zzz' } });

    expect(screen.getByText('Keine Ergebnisse für diese Suche.')).toBeInTheDocument();
  });

  it('meldet, wenn keine ausgelagerten Artikel existieren', async () => {
    api.getInventur.mockResolvedValue([]);
    rendereMitToast(<Inventur />);

    expect(await screen.findByText('Keine ausgelagerten Artikel vorhanden.')).toBeInTheDocument();
  });

  it('zeigt einen Ladefehler als Toast', async () => {
    api.getInventur.mockRejectedValue(new Error('Datenbank nicht erreichbar'));
    rendereMitToast(<Inventur />);

    expect(await screen.findByText('Datenbank nicht erreichbar')).toBeInTheDocument();
  });
});

describe('Kunden-Detail', () => {
  async function oeffneDetail() {
    rendereMitToast(<Inventur />);
    fireEvent.click(await screen.findByText('Anna Laden'));
    await screen.findByText('Inventur – Anna Laden');
    await screen.findByText('MHO001');
  }

  it('lädt das Detail des angeklickten Kunden und zeigt Kennzahlen und Warenwerte aus der API', async () => {
    await oeffneDetail();

    expect(api.getInventurKunde).toHaveBeenCalledWith(1);
    expect(screen.getByText(/Warenwert \(aktiv\):/).textContent).toMatch(/25,00\s€/);
    expect(screen.getByText(/Warenwert \(verkauft\):/).textContent).toMatch(/12,00\s€/);
    // Reiter "Nicht verkauft" ist vorgewählt: nur unverkaufte Stücke ohne Ausschuss
    expect(screen.getByText('MHO002')).toBeInTheDocument();
    expect(screen.queryByText('SBA003_1')).not.toBeInTheDocument();
    expect(screen.queryByText('SBA004_1')).not.toBeInTheDocument();
  });

  it('trennt Verkauft, Ausschuss und Alle über die Reiter', async () => {
    await oeffneDetail();

    fireEvent.click(screen.getByRole('button', { name: /^Verkauft/ }));
    expect(screen.getByText('SBA003')).toBeInTheDocument();
    expect(screen.queryByText('MHO001_1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Ausschuss/ }));
    expect(screen.getByText('SBA004')).toBeInTheDocument();
    expect(screen.queryByText('SBA003_1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Alle$/ }));
    for (const nr of ['MHO001', 'MHO002', 'SBA003', 'SBA004']) {
      expect(screen.getByText(nr)).toBeInTheDocument();
    }
  });

  it('zeigt einen Detail-Ladefehler als Toast', async () => {
    api.getInventurKunde.mockRejectedValue(new Error('Kunde nicht gefunden'));
    rendereMitToast(<Inventur />);

    fireEvent.click(await screen.findByText('Anna Laden'));

    expect(await screen.findByText('Kunde nicht gefunden')).toBeInTheDocument();
  });

  it('lagert die ausgewählten Artikel nach Bestätigung zurück und lädt die Übersicht neu', async () => {
    api.restockKundeSelective.mockResolvedValue({});
    await oeffneDetail();
    expect(screen.getByRole('button', { name: 'Zurücklagern (0)' })).toBeDisabled();

    fireEvent.click(screen.getByTitle('Alle auswählen'));
    fireEvent.click(screen.getByRole('button', { name: 'Zurücklagern (2)' }));

    await waitFor(() =>
      expect(api.restockKundeSelective).toHaveBeenCalledWith(1, ['MHO001_1', 'MHO002_1']),
    );
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2 Artikel'));
    expect(await screen.findByText('Artikel erfolgreich zurückgelagert!')).toBeInTheDocument();
    await waitFor(() => expect(api.getInventur).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Inventur – Anna Laden')).not.toBeInTheDocument();
  });

  it('lagert nichts zurück, wenn die Bestätigung abgelehnt wird', async () => {
    window.confirm.mockReturnValue(false);
    await oeffneDetail();

    fireEvent.click(screen.getByTitle('Alle auswählen'));
    fireEvent.click(screen.getByRole('button', { name: 'Zurücklagern (2)' }));

    expect(api.restockKundeSelective).not.toHaveBeenCalled();
    expect(screen.getByText('Inventur – Anna Laden')).toBeInTheDocument();
  });

  it('wählt Artikel mit "Alle auswählen" ab, wenn schon alle markiert sind', async () => {
    await oeffneDetail();

    fireEvent.click(screen.getByTitle('Alle auswählen'));
    expect(screen.getByRole('button', { name: 'Zurücklagern (2)' })).toBeEnabled();
    fireEvent.click(screen.getByTitle('Alle abwählen'));

    expect(screen.getByRole('button', { name: 'Zurücklagern (0)' })).toBeDisabled();
  });

  it('zeigt Fehler beim Zurücklagern und schließt das Detail nicht', async () => {
    api.restockKundeSelective.mockRejectedValue(new Error('Artikel bereits verkauft'));
    await oeffneDetail();

    fireEvent.click(screen.getByTitle('Alle auswählen'));
    fireEvent.click(screen.getByRole('button', { name: 'Zurücklagern (2)' }));

    expect(await screen.findByText('Artikel bereits verkauft')).toBeInTheDocument();
    expect(screen.getByText('Inventur – Anna Laden')).toBeInTheDocument();
  });

  it('erstellt eine Rechnung über die gewählten Artikel und nennt die Summe in der Rückfrage', async () => {
    api.createRechnung.mockResolvedValue({ Nummer: 'RE-2026-9' });
    await oeffneDetail();

    fireEvent.click(screen.getByTitle('Alle für Rechnung auswählen'));
    fireEvent.click(screen.getByRole('button', { name: /Rechnung erstellen \(2\)/ }));

    await waitFor(() =>
      expect(api.createRechnung).toHaveBeenCalledWith({
        Kundennummer: 1,
        Artikelnummern: ['MHO001_1', 'MHO002_1'],
      }),
    );
    expect(window.confirm.mock.calls[0][0]).toMatch(/2 Artikel \(25,00\s€\)/);
    expect(await screen.findByText('Rechnung "RE-2026-9" erfolgreich erstellt!')).toBeInTheDocument();
  });

  it('meldet Rechnungsfehler per Toast', async () => {
    api.createRechnung.mockRejectedValue(new Error('Rechnung nicht möglich'));
    await oeffneDetail();

    fireEvent.click(screen.getByTitle('Alle für Rechnung auswählen'));
    fireEvent.click(screen.getByRole('button', { name: /Rechnung erstellen \(2\)/ }));

    expect(await screen.findByText('Rechnung nicht möglich')).toBeInTheDocument();
  });

  it('erlaubt keine Rechnung ohne Auswahl', async () => {
    await oeffneDetail();

    expect(screen.getByRole('button', { name: /Rechnung erstellen \(0\)/ })).toBeDisabled();
  });

  it('startet den Excel-Export als Download mit bereinigtem Dateinamen', async () => {
    const klick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    window.URL.createObjectURL = vi.fn(() => 'blob:x');
    window.URL.revokeObjectURL = vi.fn();
    api.exportInventurExcel.mockResolvedValue(new Blob(['x']));
    await oeffneDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Excel Export' }));

    await waitFor(() => expect(klick).toHaveBeenCalled());
    expect(api.exportInventurExcel).toHaveBeenCalledWith(1);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('meldet Exportfehler per Toast', async () => {
    api.exportInventurExcel.mockRejectedValue(new Error('Export fehlgeschlagen'));
    await oeffneDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Excel Export' }));

    expect(await screen.findByText('Export fehlgeschlagen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excel Export' })).toBeEnabled();
  });
});

describe('Lager-Inventur (Entwurf)', () => {
  const entwurf = (data = {}, kommentar = '') => ({ id: 5, data, kommentar });

  async function oeffneLager() {
    rendereMitToast(<Inventur />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lager-Inventur' }));
  }

  it('zeigt vorhandene Entwürfe mit der Summe der gescannten Stücke', async () => {
    api.getInventurDrafts.mockResolvedValue([
      { id: 3, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-02T10:00:00Z', kommentar: 'Frühjahr', data: { MHO001_1: 2, MHO002_1: 3 } },
      { id: 4, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-02T10:00:00Z', kommentar: '', data: null },
    ]);
    await oeffneLager();

    expect(await screen.findByText('#3')).toBeInTheDocument();
    expect(screen.getByText('5 Stück')).toBeInTheDocument();
    expect(screen.getByText('0 Stück')).toBeInTheDocument();
    expect(screen.getByText('Frühjahr')).toBeInTheDocument();
    expect(screen.getByText('Kein Kommentar')).toBeInTheDocument();
  });

  it('meldet, wenn keine Entwürfe existieren', async () => {
    await oeffneLager();

    expect(await screen.findByText('Keine offenen Inventuren vorhanden.')).toBeInTheDocument();
  });

  it('meldet Fehler beim Laden der Entwürfe', async () => {
    api.getInventurDrafts.mockRejectedValue(new Error('kaputt'));
    await oeffneLager();

    expect(await screen.findByText('Fehler beim Laden der Inventuren: kaputt')).toBeInTheDocument();
  });

  it('legt einen neuen Entwurf an und öffnet den Editor', async () => {
    api.createInventurDraft.mockResolvedValue({ id: 5 });
    api.getInventurDraft.mockResolvedValue(entwurf());
    await oeffneLager();

    fireEvent.click(await screen.findByRole('button', { name: /Neue Inventur/ }));

    expect(await screen.findByText('Lager-Inventur #5')).toBeInTheDocument();
    expect(api.createInventurDraft).toHaveBeenCalledWith({ data: {}, kommentar: '' });
    expect(screen.getByText('Noch keine Artikel gescannt.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Auswertung anzeigen/ })).toBeDisabled();
  });

  it('meldet Fehler beim Anlegen eines Entwurfs', async () => {
    api.createInventurDraft.mockRejectedValue(new Error('Anlegen fehlgeschlagen'));
    await oeffneLager();

    fireEvent.click(await screen.findByRole('button', { name: /Neue Inventur/ }));

    expect(await screen.findByText('Anlegen fehlgeschlagen')).toBeInTheDocument();
    expect(screen.queryByText(/Lager-Inventur #/)).not.toBeInTheDocument();
  });

  async function oeffneEditor(d = entwurf()) {
    api.getInventurDrafts.mockResolvedValue([
      { id: 5, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z', kommentar: '', data: d.data },
    ]);
    api.getInventurDraft.mockResolvedValue(d);
    await oeffneLager();
    fireEvent.click(await screen.findByText('#5'));
    await screen.findByText('Lager-Inventur #5');
  }

  function scanne(nr) {
    fireEvent.change(screen.getByPlaceholderText('Artikelnummer scannen...'), { target: { value: nr } });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
  }

  it('zählt mehrfach gescannte Artikelnummern hoch und normalisiert auf Großbuchstaben', async () => {
    await oeffneEditor();

    scanne('mho001_1');
    scanne(' MHO001_1 ');
    scanne('sba003_1');

    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect(screen.getByText('MHO001_1')).toBeInTheDocument();
    expect(screen.getByText('SBA003_1')).toBeInTheDocument();
    expect(screen.getByText(/3 Stück gesamt/)).toBeInTheDocument();
  });

  it('ignoriert leere Eingaben (Button gesperrt)', async () => {
    await oeffneEditor();

    fireEvent.change(screen.getByPlaceholderText('Artikelnummer scannen...'), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeDisabled();
    expect(screen.getByText('Noch keine Artikel gescannt.')).toBeInTheDocument();
  });

  it('entfernt einen Artikel bei Anzahl 0 oder ungültiger Eingabe sowie per Löschen-Knopf', async () => {
    await oeffneEditor(entwurf({ A1: 2, B2: 3, C3: 1 }));

    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '0' } });
    expect(screen.queryByText('A1')).not.toBeInTheDocument();

    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '' } });
    expect(screen.queryByText('B2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Löschen'));
    expect(screen.queryByText('C3')).not.toBeInTheDocument();
    expect(screen.getByText('Noch keine Artikel gescannt.')).toBeInTheDocument();
  });

  it('übernimmt eine geänderte Anzahl', async () => {
    await oeffneEditor(entwurf({ A1: 2 }));

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });

    expect(screen.getByText(/7 Stück gesamt/)).toBeInTheDocument();
  });

  it('speichert Änderungen automatisch, aber nur wenn sich etwas geändert hat', async () => {
    api.updateInventurDraft.mockResolvedValue({});
    await oeffneEditor(entwurf({ A1: 1 }, 'alt'));
    await new Promise((r) => setTimeout(r, 1200));
    expect(api.updateInventurDraft).not.toHaveBeenCalled();

    scanne('A1');

    await waitFor(
      () => expect(api.updateInventurDraft).toHaveBeenCalledWith(5, { data: { A1: 2 }, kommentar: 'alt' }),
      { timeout: 3000 },
    );
  });

  it('meldet Fehler der automatischen Speicherung', async () => {
    api.updateInventurDraft.mockRejectedValue(new Error('offline'));
    await oeffneEditor();

    scanne('A1');

    expect(
      await screen.findByText('Automatische Speicherung fehlgeschlagen: offline', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it('kehrt bei Ladefehler des Entwurfs zur Liste zurück', async () => {
    api.getInventurDrafts.mockResolvedValue([
      { id: 5, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z', kommentar: '', data: {} },
    ]);
    api.getInventurDraft.mockRejectedValue(new Error('Entwurf weg'));
    await oeffneLager();

    fireEvent.click(await screen.findByText('#5'));

    expect(await screen.findByText('Entwurf weg')).toBeInTheDocument();
    expect(await screen.findByText('Offene Inventuren')).toBeInTheDocument();
  });

  it('bietet die Artikelnummern des Lagerbestands zur Vervollständigung an', async () => {
    api.getUniqueArtikelnummern.mockResolvedValue(['MHO001_1', 'MHO002_1']);
    await oeffneEditor();

    await waitFor(() =>
      expect(api.getUniqueArtikelnummern).toHaveBeenCalledWith({ ausgelagert: '0', verkauft: '0', ausschuss: '0' }),
    );
    await waitFor(() => expect(document.querySelectorAll('#artikelnummer-autocomplete option')).toHaveLength(2));
  });

  it('meldet Fehler beim Laden der Vervollständigung', async () => {
    api.getUniqueArtikelnummern.mockRejectedValue(new Error('Liste fehlt'));
    await oeffneEditor();

    expect(await screen.findByText('Fehler beim Laden der Artikelnummern: Liste fehlt')).toBeInTheDocument();
  });
});

describe('Lager-Inventur (Abschluss und Auswertung)', () => {
  const diff = {
    stats: { fehlend: 1, unbekannt: 1, gefunden: 1, soll: 3 },
    fehlend: [{ Artikelnummer: 'MHO001_1', Name: 'Ohrring Rot', Soll: 2, Ist: 1, Fehlt: 1 }],
    unbekannt: [{ Artikelnummer: 'XXX999_1', Name: '', Soll: 0, Ist: 1, Zuviel: 1 }],
    gefunden: [{ Artikelnummer: 'MHO002_1', Name: 'Ohrring Blau', Soll: 1, Gefunden: 1 }],
  };

  async function oeffneEditor(data = { MHO001_1: 1 }) {
    api.getInventurDrafts.mockResolvedValue([
      { id: 5, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z', kommentar: '', data },
    ]);
    api.getInventurDraft.mockResolvedValue({ id: 5, data, kommentar: '' });
    api.getInventurDiff.mockResolvedValue(diff);
    api.updateInventurDraft.mockResolvedValue({});
    api.completeInventurDraft.mockResolvedValue({});
    rendereMitToast(<Inventur />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lager-Inventur' }));
    fireEvent.click(await screen.findByText('#5'));
    await screen.findByText('Lager-Inventur #5');
  }

  it('zeigt die Auswertung mit Fehlend, Unbekannt und Gefunden aus der API', async () => {
    await oeffneEditor();

    fireEvent.click(screen.getByRole('button', { name: /Auswertung anzeigen/ }));

    expect(await screen.findByText('Fehlende Artikelnummern (1)')).toBeInTheDocument();
    expect(api.getInventurDiff).toHaveBeenCalledWith(5);
    expect(screen.getByText('Ohrring Rot')).toBeInTheDocument();
    expect(screen.getByText('Soll-Bestand').previousSibling).toHaveTextContent('3');

    fireEvent.click(screen.getByText('Unbekannt'));
    expect(screen.getByText('XXX999_1')).toBeInTheDocument();
    expect(screen.getByText('–')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Gefunden'));
    expect(screen.getByText('MHO002_1')).toBeInTheDocument();
  });

  it('zeigt Positivmeldungen bei leeren Abweichungslisten', async () => {
    api.getInventurDiff.mockResolvedValue({
      stats: { fehlend: 0, unbekannt: 0, gefunden: 0, soll: 0 },
      fehlend: [],
      unbekannt: [],
      gefunden: [],
    });
    await oeffneEditor();
    api.getInventurDiff.mockResolvedValue({
      stats: { fehlend: 0, unbekannt: 0, gefunden: 0, soll: 0 },
      fehlend: [],
      unbekannt: [],
      gefunden: [],
    });

    fireEvent.click(screen.getByRole('button', { name: /Auswertung anzeigen/ }));

    expect(await screen.findByText(/Keine Artikel fehlen/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Unbekannt'));
    expect(screen.getByText(/Keine unbekannten Artikel gescannt/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Gefunden'));
    expect(screen.getByText('Keine Artikel übereinstimmend.')).toBeInTheDocument();
  });

  it('speichert vor der Auswertung und meldet Auswertungsfehler', async () => {
    await oeffneEditor();
    api.getInventurDiff.mockRejectedValue(new Error('Diff kaputt'));

    fireEvent.click(screen.getByRole('button', { name: /Auswertung anzeigen/ }));

    expect(await screen.findByText('Fehler beim Laden der Auswertung: Diff kaputt')).toBeInTheDocument();
  });

  it('bricht die Auswertung ab, wenn das Speichern scheitert', async () => {
    await oeffneEditor({});
    fireEvent.change(screen.getByPlaceholderText('Artikelnummer scannen...'), { target: { value: 'A1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    api.updateInventurDraft.mockRejectedValue(new Error('offline'));

    fireEvent.click(screen.getByRole('button', { name: /Auswertung anzeigen/ }));

    expect(await screen.findByText('Fehler vor Auswertung: offline')).toBeInTheDocument();
    expect(api.getInventurDiff).not.toHaveBeenCalled();
  });

  it('schließt nach Bestätigung ab, zeigt die Auswertung und kehrt danach zur Liste zurück', async () => {
    await oeffneEditor();

    fireEvent.click(screen.getByRole('button', { name: /Abschließen/ }));

    expect(await screen.findByText('Inventur-Auswertung #5')).toBeInTheDocument();
    expect(api.completeInventurDraft).toHaveBeenCalledWith(5);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('nicht mehr bearbeitet'));

    fireEvent.click(document.querySelector('.modal-close'));
    expect(await screen.findByText('Offene Inventuren')).toBeInTheDocument();
  });

  it('schließt nicht ab, wenn die Bestätigung abgelehnt wird', async () => {
    window.confirm.mockReturnValue(false);
    await oeffneEditor();

    fireEvent.click(screen.getByRole('button', { name: /Abschließen/ }));

    expect(api.completeInventurDraft).not.toHaveBeenCalled();
    expect(screen.queryByText('Inventur-Auswertung #5')).not.toBeInTheDocument();
  });

  it('meldet Abschlussfehler und bleibt im Editor', async () => {
    api.completeInventurDraft.mockRejectedValue(new Error('Bereits abgeschlossen'));
    await oeffneEditor();
    api.completeInventurDraft.mockRejectedValue(new Error('Bereits abgeschlossen'));

    fireEvent.click(screen.getByRole('button', { name: /Abschließen/ }));

    expect(await screen.findByText('Fehler beim Abschließen: Bereits abgeschlossen')).toBeInTheDocument();
    expect(screen.getByText('Lager-Inventur #5')).toBeInTheDocument();
  });
});
