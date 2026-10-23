import { screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { rendereMitToast } from './helpers/rendern';
import Schmuckstuecke from '../pages/Schmuckstuecke';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

vi.mock('../api', () => ({
  api: {
    getFilterOptions: vi.fn(),
    getKunden: vi.fn(),
    getSchmuckstuecke: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../components/TablePhoto', () => ({ default: () => null }));

// Gemeinsamer Aufbau für alle Tests der Seite: API-Mocks, Rolle und Rendern.
function rendereSeite(rolle = 'bearbeiter') {
  useAuth.mockReturnValue({ user: { username: 'test', role: rolle } });
  return rendereMitToast(
    <MemoryRouter>
      <Schmuckstuecke />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getFilterOptions.mockResolvedValue({ grundmaterialien: [], produktarten: [] });
  api.getKunden.mockResolvedValue([]);
  api.getSchmuckstuecke.mockResolvedValue({ data: [], pagination: { total: 0 } });
});

describe('Aus Vorlage anlegen', () => {
  it('zeigt Bearbeitern den Button "+ Aus Vorlage anlegen" statt "nachtragen"', async () => {
    rendereSeite('bearbeiter');

    expect(await screen.findByRole('button', { name: '+ Aus Vorlage anlegen' })).toBeInTheDocument();
    expect(screen.queryByText(/nachtragen/)).not.toBeInTheDocument();
  });

  it('öffnet beim Klick das Modal "Schmuckstücke aus Vorlage anlegen"', async () => {
    rendereSeite('admin');

    fireEvent.click(await screen.findByRole('button', { name: '+ Aus Vorlage anlegen' }));

    expect(
      screen.getByRole('heading', { name: 'Schmuckstücke aus Vorlage anlegen' }),
    ).toBeInTheDocument();
  });

  it('blendet den Button für die Rolle user aus', async () => {
    rendereSeite('user');

    await screen.findByRole('button', { name: '+ Neues Schmuckstück' });
    expect(screen.queryByRole('button', { name: '+ Aus Vorlage anlegen' })).not.toBeInTheDocument();
  });
});
