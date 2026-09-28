import { screen, fireEvent, waitFor } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import React from 'react';
import Rechnungen from '../pages/Rechnungen';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getRechnungen: vi.fn(),
    getNextRechnungsnummer: vi.fn(),
    getKunden: vi.fn(),
    getSchmuckstuecke: vi.fn(),
  },
}));

describe('Rechnungen – Stückauswahl', () => {
  beforeEach(() => {
    api.getRechnungen.mockResolvedValue([]);
    api.getNextRechnungsnummer.mockResolvedValue({ Nummer: '2026-100' });
    api.getKunden.mockResolvedValue([
      { ID: 1, Name: 'Puralei', Aktiv: true, Direktverkauf: false },
      { ID: 15, Name: 'Online', Aktiv: true, Direktverkauf: true },
    ]);
    api.getSchmuckstuecke.mockResolvedValue({ data: [] });
  });

  async function waehleKunde(id) {
    rendereMitToast(<Rechnungen />);
    await waitFor(() => expect(api.getKunden).toHaveBeenCalled());
    fireEvent.click(screen.getByText('+ Neue Rechnung'));
    fireEvent.change(await screen.findByDisplayValue('Bitte wählen...'), { target: { value: id } });
    await waitFor(() => expect(api.getSchmuckstuecke).toHaveBeenCalled());
    return api.getSchmuckstuecke.mock.lastCall[0];
  }

  it('bietet bei Direktverkauf Lager und Kunde an', async () => {
    expect(await waehleKunde('15')).toMatchObject({ ausgelagert: '0,15', verkauft: '0', ausschuss: '0' });
  });

  it('bietet sonst nur die beim Kunden ausgelagerten Stücke an', async () => {
    expect(await waehleKunde('1')).toMatchObject({ ausgelagert: '1' });
  });
});
