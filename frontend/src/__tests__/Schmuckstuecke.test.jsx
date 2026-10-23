import { screen, fireEvent, waitFor } from '@testing-library/react';
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
    getSchmuckstueck: vi.fn(),
    getNextArtikelnummer: vi.fn(),
    createSchmuckstueckeBulk: vi.fn(),
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

describe('Vorlage laden: neue Artikelnummer', () => {
  const vorlage = (artikelnummer, extra = {}) => ({
    Artikelnummer: artikelnummer,
    Name: 'Tropfen',
    Art: 'Ohrring',
    Material: 'Harz',
    Farbe: 'Blau',
    Verkaufspreis: 24.5,
    Herstellungskosten: 9.5,
    Form: 'Rund',
    Fassung: 'Silber',
    ...extra,
  });

  async function oeffneModal(rolle = 'bearbeiter') {
    rendereSeite(rolle);
    fireEvent.click(await screen.findByRole('button', { name: '+ Aus Vorlage anlegen' }));
  }

  async function ladeVorlage(artikelnummer) {
    fireEvent.change(screen.getByPlaceholderText('z.B. MBH001_1'), {
      target: { value: artikelnummer },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Als neue Zeile übernehmen' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Als neue Zeile übernehmen' })).toBeEnabled(),
    );
  }

  beforeEach(() => {
    api.getSchmuckstueck.mockImplementation(async (nr) => vorlage(nr));
    api.getNextArtikelnummer.mockResolvedValue({
      prefix: 'MHO',
      nextNum: 127,
      artikelnummer: 'MHO127',
    });
    api.createSchmuckstueckeBulk.mockResolvedValue({ createdCount: 1 });
  });

  it('vergibt eine neue Laufnummer und übernimmt die sichtbaren Felder', async () => {
    await oeffneModal();
    await ladeVorlage('MHO123_1');

    expect(api.getNextArtikelnummer).toHaveBeenCalledWith('MHO');
    const nummernfelder = screen.getAllByPlaceholderText('MBH001_2');
    expect(nummernfelder.map((f) => f.value)).toEqual(['', 'MHO127_1']);
    expect(screen.getByDisplayValue('Tropfen')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ohrring')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Harz')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Blau')).toBeInTheDocument();
    expect(screen.getByDisplayValue('24.5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Rund')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Silber')).toBeInTheDocument();
  });

  it('zählt bei einer zweiten Vorlage mit gleichem Präfix hoch', async () => {
    await oeffneModal();
    await ladeVorlage('MHO123_1');
    await ladeVorlage('MHO124_1');

    const nummernfelder = screen.getAllByPlaceholderText('MBH001_2');
    expect(nummernfelder.map((f) => f.value)).toEqual(['', 'MHO127_1', 'MHO128_1']);
  });

  it('übernimmt die Herstellungskosten der Vorlage nicht', async () => {
    await oeffneModal();
    await ladeVorlage('MHO123_1');

    fireEvent.click(screen.getByRole('button', { name: 'Mehrfach speichern' }));

    await waitFor(() => expect(api.createSchmuckstueckeBulk).toHaveBeenCalledTimes(1));
    const { items } = api.createSchmuckstueckeBulk.mock.calls[0][0];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      Artikelnummer: 'MHO127_1',
      Name: 'Tropfen',
      Verkaufspreis: 24.5,
      Herstellungskosten: 0,
    });
  });

  it('meldet das erfolgreiche Anlegen als Erfolg, nicht als Fehler', async () => {
    await oeffneModal();
    await ladeVorlage('MHO123_1');

    fireEvent.click(screen.getByRole('button', { name: 'Mehrfach speichern' }));

    const meldung = await screen.findByText('1 Schmuckstücke wurden erfolgreich angelegt.');
    expect(meldung.closest('.toast')).toHaveClass('toast-erfolg');
  });

  it('fügt bei Fehler der Nummernvergabe eine Zeile ohne Artikelnummer ein und zeigt einen Fehlertoast', async () => {
    api.getNextArtikelnummer.mockRejectedValue(new Error('Server nicht erreichbar'));
    await oeffneModal();
    await ladeVorlage('MHO123_1');

    expect(await screen.findByText(/Server nicht erreichbar/)).toBeInTheDocument();
    const nummernfelder = screen.getAllByPlaceholderText('MBH001_2');
    expect(nummernfelder.map((f) => f.value)).toEqual(['', '']);
    expect(screen.getByDisplayValue('Tropfen')).toBeInTheDocument();
  });
});
