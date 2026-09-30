import { screen, fireEvent, waitFor } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import Sumup from '../pages/Sumup';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    importSumupCsv: vi.fn(),
    exportSumupCsv: vi.fn(),
  },
}));

const CSV = 'Beschreibung;Menge\nMBH001;1';

function waehleDatei(inhalt = CSV, name = 'bericht.csv') {
  const datei = new File([inhalt], name, { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText(/SumUp CSV-Datei wählen/), { target: { files: [datei] } });
  return datei;
}

const ergebnis = (rechnungen) => ({
  lieferschein: { Nummer: 'LS-7' },
  artikel: { gesamt: 3, marina: 2, saskia: 1 },
  rechnungen,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe('Import', () => {
  it('sendet den CSV-Text an die API und zeigt Lieferschein, Artikel und beide Rechnungen', async () => {
    api.importSumupCsv.mockResolvedValue(
      ergebnis({ marina: { Nummer: 'RE-1' }, saskia: { Nummer: 'RE-2' } }),
    );
    rendereMitToast(<Sumup />);

    const datei = waehleDatei();

    expect(await screen.findByText('Import erfolgreich!')).toBeInTheDocument();
    expect(api.importSumupCsv).toHaveBeenCalledWith(CSV);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(datei.name));
    expect(screen.getByText(/LS-7/)).toBeInTheDocument();
    expect(screen.getByText(/3 gesamt \(2 Marina, 1 Saskia\)/)).toBeInTheDocument();
    expect(screen.getByText(/RE-1/)).toBeInTheDocument();
    expect(screen.getByText(/RE-2/)).toBeInTheDocument();
  });

  it('zeigt nur die Rechnung der Herstellerin, die verkauft hat', async () => {
    api.importSumupCsv.mockResolvedValue(ergebnis({ marina: { Nummer: 'RE-1' }, saskia: null }));
    rendereMitToast(<Sumup />);

    waehleDatei();

    expect(await screen.findByText(/Rechnung Marina/)).toBeInTheDocument();
    expect(screen.queryByText(/Rechnung Saskia/)).not.toBeInTheDocument();
  });

  it('importiert nichts, wenn die Sicherheitsabfrage abgelehnt wird', async () => {
    window.confirm.mockReturnValue(false);
    rendereMitToast(<Sumup />);

    waehleDatei();

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(api.importSumupCsv).not.toHaveBeenCalled();
    expect(screen.queryByText('Import erfolgreich!')).not.toBeInTheDocument();
  });

  it('ignoriert eine leere Dateiauswahl', () => {
    rendereMitToast(<Sumup />);

    fireEvent.change(screen.getByLabelText(/SumUp CSV-Datei wählen/), { target: { files: [] } });

    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.importSumupCsv).not.toHaveBeenCalled();
  });

  it('reicht eine leere Datei unverändert an die API weiter und zeigt deren Fehler', async () => {
    api.importSumupCsv.mockRejectedValue(new Error('CSV ist leer'));
    rendereMitToast(<Sumup />);

    waehleDatei('', 'leer.csv');

    expect(await screen.findByText('CSV ist leer')).toBeInTheDocument();
    expect(api.importSumupCsv).toHaveBeenCalledWith('');
    expect(screen.queryByText('Import erfolgreich!')).not.toBeInTheDocument();
  });

  it('blendet bei Spaltenfehlern die Hilfe zur Fehlersuche ein', async () => {
    api.importSumupCsv.mockRejectedValue(new Error('Keine passenden Spalten gefunden'));
    rendereMitToast(<Sumup />);

    waehleDatei('x;y\n1;2');

    expect(await screen.findByText(/Keine passenden Spalten gefunden/)).toBeInTheDocument();
    expect(screen.getByText(/Klicken für Hilfe zur Fehlersuche/)).toBeInTheDocument();
  });

  it('zeigt bei anderen Fehlern keine Fehlersuche-Hilfe', async () => {
    api.importSumupCsv.mockRejectedValue(new Error('Server nicht erreichbar'));
    rendereMitToast(<Sumup />);

    waehleDatei();

    expect(await screen.findByText(/Server nicht erreichbar/)).toBeInTheDocument();
    expect(screen.queryByText(/Hilfe zur Fehlersuche/)).not.toBeInTheDocument();
  });

  it('sperrt die Dateiauswahl während des Imports und gibt sie danach wieder frei', async () => {
    let fertig;
    api.importSumupCsv.mockReturnValue(new Promise((resolve) => { fertig = resolve; }));
    rendereMitToast(<Sumup />);

    waehleDatei();

    expect(await screen.findByText(/Importiere…/)).toBeInTheDocument();
    fertig(ergebnis({}));
    expect(await screen.findByText('Import erfolgreich!')).toBeInTheDocument();
    expect(screen.getByLabelText(/SumUp CSV-Datei wählen/)).not.toBeDisabled();
  });
});

describe('Export', () => {
  beforeEach(() => {
    window.URL.createObjectURL = vi.fn(() => 'blob:x');
    window.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('lädt den Export als CSV-Download herunter', async () => {
    const blob = new Blob(['csv']);
    api.exportSumupCsv.mockResolvedValue(blob);
    rendereMitToast(<Sumup />);

    fireEvent.click(screen.getByRole('button', { name: /CSV für SumUp herunterladen/ }));

    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('meldet einen Exportfehler per Toast und reaktiviert den Button', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.exportSumupCsv.mockRejectedValue(new Error('Kaputt'));
    rendereMitToast(<Sumup />);

    fireEvent.click(screen.getByRole('button', { name: /CSV für SumUp herunterladen/ }));

    expect(await screen.findByText(/Fehler beim Export: Kaputt/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /CSV für SumUp herunterladen/ })).not.toBeDisabled();
  });
});
