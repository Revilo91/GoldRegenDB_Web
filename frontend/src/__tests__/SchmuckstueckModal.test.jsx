import { screen, fireEvent, waitFor } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import React from 'react';
import SchmuckstueckModal from '../components/SchmuckstueckModal';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getSchmuckstueck: vi.fn(),
    getKunden: vi.fn(),
    loadPhotoAsDataUrl: vi.fn(),
  },
}));

const artikel = {
  Artikelnummer: 'MHO001',
  Name: 'Goldkette',
  Verkauft: false,
  Ausschuss: false,
  Ausgelagert: 0,
  hatFoto: false,
  Grundmaterial: 'Gold',
  Verkaufspreis: '120.00',
};

describe('SchmuckstueckModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getKunden.mockResolvedValue([{ ID: 1, Name: 'Anna' }]);
  });

  it('zeigt einen Ladezustand, bis die Daten eintreffen', async () => {
    let resolveGet;
    api.getSchmuckstueck.mockReturnValue(new Promise((resolve) => (resolveGet = resolve)));

    rendereMitToast(<SchmuckstueckModal artikelnummer="MHO001" onClose={() => {}} />);

    expect(screen.getByText('Lade…')).toBeInTheDocument();
    resolveGet(artikel);
    await waitFor(() => expect(screen.queryByText('Lade…')).not.toBeInTheDocument());
  });

  it('rendert die Details eines Schmuckstücks im Lager', async () => {
    api.getSchmuckstueck.mockResolvedValue(artikel);

    rendereMitToast(<SchmuckstueckModal artikelnummer="MHO001" onClose={() => {}} />);

    expect(await screen.findByText('Lager')).toBeInTheDocument();
    expect(screen.getByText('Goldkette')).toBeInTheDocument();
    // formatEur statt `${wert}€`: deutsche Schreibweise mit zwei
    // Nachkommastellen, einheitlich im ganzen Projekt (Befund G21).
    expect(screen.getByText(/120,00/)).toBeInTheDocument();
  });

  it('lädt das Foto über die Artikelnummer, wenn hatFoto gesetzt ist', async () => {
    api.getSchmuckstueck.mockResolvedValue({ ...artikel, Artikelnummer: 'MHO001_2', hatFoto: true });
    api.loadPhotoAsDataUrl.mockResolvedValue('data:image/png;base64,AAAA');

    rendereMitToast(<SchmuckstueckModal artikelnummer="MHO001_2" onClose={() => {}} />);

    expect(await screen.findByAltText('MHO001_2')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(api.loadPhotoAsDataUrl).toHaveBeenCalledWith('MHO001_2');
  });

  it('fragt ohne hatFoto kein Foto an', async () => {
    api.getSchmuckstueck.mockResolvedValue(artikel);

    rendereMitToast(<SchmuckstueckModal artikelnummer="MHO001" onClose={() => {}} />);

    expect(await screen.findByText('Kein Bild vorhanden')).toBeInTheDocument();
    expect(api.loadPhotoAsDataUrl).not.toHaveBeenCalled();
  });

  it('zeigt den Ausgelagert-Status mit Kundennamen', async () => {
    api.getSchmuckstueck.mockResolvedValue({ ...artikel, Ausgelagert: 1 });

    rendereMitToast(<SchmuckstueckModal artikelnummer="MHO001" onClose={() => {}} />);

    expect(await screen.findByText('Anna')).toBeInTheDocument();
  });

  it('zeigt den Verkauft-Status mit Kundennamen', async () => {
    api.getSchmuckstueck.mockResolvedValue({ ...artikel, Verkauft: true, Ausgelagert: 1 });

    rendereMitToast(<SchmuckstueckModal artikelnummer="MHO001" onClose={() => {}} />);

    expect(await screen.findByText('Verkauft')).toBeInTheDocument();
  });

  it('ruft onClose auf und zeigt eine Fehlermeldung, wenn das Laden fehlschlägt', async () => {
    const onClose = vi.fn();
    api.getSchmuckstueck.mockRejectedValue(new Error('Netzwerkfehler'));

    rendereMitToast(<SchmuckstueckModal artikelnummer="MHO001" onClose={onClose} />);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText(/Netzwerkfehler/)).toBeInTheDocument();
  });

  it('schließt das Modal über den Schließen-Button', async () => {
    const onClose = vi.fn();
    api.getSchmuckstueck.mockResolvedValue(artikel);

    rendereMitToast(<SchmuckstueckModal artikelnummer="MHO001" onClose={onClose} />);
    await screen.findByText('Goldkette');

    fireEvent.click(screen.getByRole('button', { name: '' }));

    expect(onClose).toHaveBeenCalled();
  });
});
