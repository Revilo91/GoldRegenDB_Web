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
    starteSqlSicherung: vi.fn(),
    getSqlSicherungStatus: vi.fn(),
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

const sicherung = (felder) => ({
  status: 'idle',
  gestartetAm: null,
  beendetAm: null,
  datei: null,
  groesse: null,
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
  api.getSqlSicherungStatus.mockResolvedValue({ sicherung: sicherung() });
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

it('bietet die Tabellen aus einem SQL-Dump zum Import an', async () => {
  rendereMitToast(<Datensicherung />);
  const dump = new File(
    ['COPY public."Kunde" ("ID", "Name") FROM stdin;\n1\tA\n\\.\n'],
    'goldregendb_dump.sql',
    { type: 'application/sql' },
  );
  fireEvent.change(screen.getByLabelText(/SQL-Dump wählen/), { target: { files: [dump] } });
  expect(await screen.findByText('goldregendb_dump.sql')).toBeInTheDocument();
  // Export- und Importliste: Kunden zweimal, Rechnungen nur im Export.
  expect(screen.getAllByRole('checkbox', { name: 'Kunden' })).toHaveLength(2);
  expect(screen.getAllByRole('checkbox', { name: 'Rechnungen' })).toHaveLength(1);
});

describe('Jetzt sichern', () => {
  const DATEI = 'goldregendb_manuell_2026-11-01T10-00-00-000Z.dump';
  const laeuft = sicherung({ status: 'running', gestartetAm: '2026-11-01T10:00:00.000Z' });
  const fertig = sicherung({
    status: 'completed',
    gestartetAm: '2026-11-01T10:00:00.000Z',
    beendetAm: '2026-11-01T10:05:00.000Z',
    datei: DATEI,
    groesse: 3 * 1024 * 1024,
  });
  const knopf = () => screen.getByRole('button', { name: /Jetzt sichern|Sicherung läuft/ });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startet die Sicherung, sperrt den Button, fragt den Stand ab und meldet den Erfolg', async () => {
    api.starteSqlSicherung.mockResolvedValue({ sicherung: laeuft });
    api.getSqlSicherungStatus
      .mockResolvedValueOnce({ sicherung: sicherung() })
      .mockResolvedValueOnce({ sicherung: { ...laeuft } })
      .mockResolvedValue({ sicherung: fertig });
    rendereMitToast(<Datensicherung />);
    await waitFor(() => expect(api.getSqlSicherungStatus).toHaveBeenCalledTimes(1));

    expect(knopf()).toBeEnabled();
    fireEvent.click(knopf());

    await waitFor(() => expect(knopf()).toBeDisabled());
    expect(api.starteSqlSicherung).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status', { name: 'Stand der Sicherung' })).toHaveTextContent('läuft');

    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(api.getSqlSicherungStatus).toHaveBeenCalledTimes(2));
    expect(knopf()).toBeDisabled();
    await vi.advanceTimersByTimeAsync(2000);

    await waitFor(() => expect(knopf()).toBeEnabled());
    expect(screen.getAllByText(/Sicherung erstellt/).length).toBeGreaterThan(0);
    expect(screen.getByText(DATEI)).toBeInTheDocument();
    expect(screen.getByText(/3,0 MB/)).toBeInTheDocument();

    const aufrufe = api.getSqlSicherungStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.getSqlSicherungStatus).toHaveBeenCalledTimes(aufrufe);
  });

  it('meldet einen Fehler der Sicherung per Toast und gibt den Button wieder frei', async () => {
    api.starteSqlSicherung.mockResolvedValue({ sicherung: laeuft });
    api.getSqlSicherungStatus
      .mockResolvedValueOnce({ sicherung: sicherung() })
      .mockResolvedValue({
        sicherung: sicherung({ status: 'failed', fehler: 'pg_dump fehlgeschlagen (Details im Server-Log)' }),
      });
    rendereMitToast(<Datensicherung />);
    await waitFor(() => expect(api.getSqlSicherungStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(knopf());
    await screen.findByRole('status', { name: 'Stand der Sicherung' });
    await vi.advanceTimersByTimeAsync(2000);

    expect(await screen.findByRole('alert')).toHaveTextContent('pg_dump fehlgeschlagen');
    await waitFor(() => expect(knopf()).toBeEnabled());
  });

  it('meldet einen fehlgeschlagenen Start per Toast', async () => {
    api.starteSqlSicherung.mockRejectedValue(new Error('Backend nicht erreichbar'));
    rendereMitToast(<Datensicherung />);
    await waitFor(() => expect(api.getSqlSicherungStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(knopf());

    expect(await screen.findByRole('alert')).toHaveTextContent('Backend nicht erreichbar');
    expect(knopf()).toBeEnabled();
  });

  it('übernimmt bei 409 den laufenden Lauf und fragt weiter ab', async () => {
    const konflikt = Object.assign(new Error('Es läuft bereits eine Sicherung'), { status: 409 });
    api.starteSqlSicherung.mockRejectedValue(konflikt);
    api.getSqlSicherungStatus
      .mockResolvedValueOnce({ sicherung: sicherung() })
      .mockImplementation(async () => ({ sicherung: { ...laeuft } }));
    rendereMitToast(<Datensicherung />);
    await waitFor(() => expect(api.getSqlSicherungStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(knopf());

    await waitFor(() => expect(knopf()).toBeDisabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.getSqlSicherungStatus.mock.calls.length).toBeGreaterThan(1);
  });

  it('setzt einen beim Laden bereits laufenden Lauf fort', async () => {
    api.getSqlSicherungStatus
      .mockResolvedValueOnce({ sicherung: laeuft })
      .mockResolvedValue({ sicherung: fertig });
    rendereMitToast(<Datensicherung />);

    await waitFor(() => expect(knopf()).toBeDisabled());
    await vi.advanceTimersByTimeAsync(2000);

    await waitFor(() => expect(knopf()).toBeEnabled());
    expect(screen.getByText(DATEI)).toBeInTheDocument();
  });

  it('zeigt das Ergebnis eines früheren Laufs ohne Toast', async () => {
    api.getSqlSicherungStatus.mockResolvedValue({ sicherung: fertig });
    rendereMitToast(<Datensicherung />);

    expect(await screen.findByText(DATEI)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(knopf()).toBeEnabled();
  });

  it('räumt den Abfrage-Timer beim Verlassen der Seite auf', async () => {
    api.getSqlSicherungStatus.mockImplementation(async () => ({ sicherung: { ...laeuft } }));
    const { unmount } = rendereMitToast(<Datensicherung />);
    await waitFor(() => expect(knopf()).toBeDisabled());
    await vi.advanceTimersByTimeAsync(2000);
    const aufrufe = api.getSqlSicherungStatus.mock.calls.length;

    unmount();
    await vi.advanceTimersByTimeAsync(10000);

    expect(api.getSqlSicherungStatus).toHaveBeenCalledTimes(aufrufe);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bricht die Abfrage bei einem Netzwerkfehler mit Toast ab', async () => {
    api.starteSqlSicherung.mockResolvedValue({ sicherung: laeuft });
    api.getSqlSicherungStatus
      .mockResolvedValueOnce({ sicherung: sicherung() })
      .mockRejectedValue(new Error('Backend nicht erreichbar'));
    rendereMitToast(<Datensicherung />);
    await waitFor(() => expect(api.getSqlSicherungStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(knopf());
    await screen.findByRole('status', { name: 'Stand der Sicherung' });
    await vi.advanceTimersByTimeAsync(2000);

    expect(await screen.findByRole('alert')).toHaveTextContent('Backend nicht erreichbar');
    await waitFor(() => expect(knopf()).toBeEnabled());
  });
});
