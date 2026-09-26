import { screen, fireEvent, waitFor } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import Datensicherung from '../pages/Datensicherung';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getBackupTables: vi.fn(),
    fotoBackupUrl: '/api/backup/export-fotos',
    importBackupFotosZip: vi.fn(),
    getBackupFotosImportJob: vi.fn(),
  },
}));

const job = (felder) => ({
  id: 'j1',
  status: 'running',
  gesamt: 3,
  verarbeitet: 0,
  gespeichert: { schmuckstueck: 0, bestellung: 0 },
  uebersprungen: 0,
  uebersprungenDetails: [],
  fehler: null,
  ...felder,
});

function waehleZip() {
  const zip = new File(['PK'], 'fotos.zip', { type: 'application/zip' });
  fireEvent.change(screen.getByLabelText(/Foto-ZIP wählen/), { target: { files: [zip] } });
  fireEvent.click(screen.getByRole('button', { name: 'Fotos jetzt importieren' }));
  return zip;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getBackupTables.mockResolvedValue({ tables: [] });
});

it('verlinkt den Foto-Export als nativen Download', () => {
  rendereMitToast(<Datensicherung />);

  const link = screen.getByRole('link', { name: /Fotos als ZIP herunterladen/ });
  expect(link).toHaveAttribute('href', '/api/backup/export-fotos');
  expect(link).toHaveAttribute('download');
});

it('lädt das Foto-ZIP hoch, fragt den Job ab und zeigt Ergebnis und übersprungene Dateien', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.importBackupFotosZip.mockResolvedValue({ job: job() });
  api.getBackupFotosImportJob.mockResolvedValue({
    job: job({
      status: 'completed',
      verarbeitet: 3,
      gespeichert: { schmuckstueck: 1, bestellung: 1 },
      uebersprungen: 1,
      uebersprungenDetails: [{ datei: 'notiz.txt', grund: 'Unbekannter Pfad' }],
    }),
  });
  rendereMitToast(<Datensicherung />);

  const zip = waehleZip();

  expect(await screen.findByText('Fotos werden importiert…')).toBeInTheDocument();
  expect(api.importBackupFotosZip).toHaveBeenCalledWith(zip);
  await vi.advanceTimersByTimeAsync(1000);

  expect(await screen.findByText('Foto-Import abgeschlossen', { selector: 'strong' })).toBeInTheDocument();
  expect(api.getBackupFotosImportJob).toHaveBeenCalledWith('j1');
  expect(screen.getByText(/1 Schmuckstück-Fotos, 1 Bestellfotos gespeichert · 1 übersprungen/)).toBeInTheDocument();
  expect(screen.getByText('notiz.txt')).toBeInTheDocument();
  vi.useRealTimers();
});

it('meldet einen abgebrochenen Import mit Ursache', async () => {
  api.importBackupFotosZip.mockResolvedValue({
    job: job({ status: 'failed', fehler: 'invalid central directory file header signature' }),
  });
  rendereMitToast(<Datensicherung />);

  waehleZip();

  expect(await screen.findByText('Foto-Import abgebrochen', { selector: 'strong' })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getAllByText(/invalid central directory/).length).toBeGreaterThan(0),
  );
  expect(api.getBackupFotosImportJob).not.toHaveBeenCalled();
});
