import { screen, fireEvent, waitFor } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import Lieferscheine from '../pages/Lieferscheine';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getLieferscheine: vi.fn(),
    getNextLieferscheinnummer: vi.fn(),
    getLieferschein: vi.fn(),
    deleteLieferschein: vi.fn(),
    createLieferschein: vi.fn(),
    updateLieferschein: vi.fn(),
    exportLieferscheinExcel: vi.fn(),
    getKunden: vi.fn(),
    getSchmuckstuecke: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.getLieferscheine.mockResolvedValue([
    { ID: 1, Nummer: '2026-001', Kundennummer: 1, KundenName: 'Anna Laden', status: 'final', Datum: '2026-01-01' },
  ]);
  api.getNextLieferscheinnummer.mockResolvedValue({ Nummer: '2026-002' });
  api.getKunden.mockResolvedValue([{ ID: 1, Name: 'Anna Laden', Aktiv: true }]);
  api.getSchmuckstuecke.mockResolvedValue({ data: [] });
});

it('lädt und zeigt die Lieferscheine mit Kundennamen', async () => {
  rendereMitToast(<Lieferscheine />);

  expect(await screen.findByText('2026-001')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Anna Laden' })).toBeInTheDocument();
  expect(api.getLieferscheine).toHaveBeenCalled();
});

it('bietet für neue Lieferscheine nur Lagerstücke an (nicht ausgelagert, nicht verkauft, kein Ausschuss)', async () => {
  rendereMitToast(<Lieferscheine />);
  await waitFor(() => expect(api.getKunden).toHaveBeenCalled());

  fireEvent.click(screen.getByText('+ Neuer Lieferschein'));
  fireEvent.change(await screen.findByDisplayValue('Bitte wählen...'), { target: { value: '1' } });

  await waitFor(() => expect(api.getSchmuckstuecke).toHaveBeenCalled());
  expect(api.getSchmuckstuecke.mock.lastCall[0]).toMatchObject({
    ausgelagert: '0',
    verkauft: '0',
    ausschuss: '0',
  });
});

it('zeigt eine leere Liste ohne Fehler, wenn es keine Lieferscheine gibt', async () => {
  api.getLieferscheine.mockResolvedValue([]);
  rendereMitToast(<Lieferscheine />);

  await waitFor(() => expect(api.getLieferscheine).toHaveBeenCalled());
  expect(screen.queryByText('2026-001')).not.toBeInTheDocument();
  expect(screen.getByText('+ Neuer Lieferschein')).toBeInTheDocument();
});
