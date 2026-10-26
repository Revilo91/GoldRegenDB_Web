import { screen, fireEvent, waitFor } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import { ToastProvider } from '../components/Toast';
import SchmuckstueckDetailPanel from '../components/SchmuckstueckDetailPanel';
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

beforeEach(() => {
  vi.clearAllMocks();
  api.getKunden.mockResolvedValue([{ ID: 1, Name: 'Anna' }]);
  api.getSchmuckstueck.mockResolvedValue(artikel);
});

describe('SchmuckstueckDetailPanel', () => {
  it('zeigt Nummer, Status, Name, Foto-Platzhalter und Daten', async () => {
    rendereMitToast(<SchmuckstueckDetailPanel artikelnummer="MHO001" onClose={() => {}} />);

    expect(await screen.findByText('Goldkette')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /MHO001/ })).toBeInTheDocument();
    expect(screen.getByText('Lager')).toBeInTheDocument();
    expect(screen.getByText('Kein Bild vorhanden')).toBeInTheDocument();
    expect(screen.getByText('Grundmaterial')).toBeInTheDocument();
    expect(screen.getByText(/120,00/)).toBeInTheDocument();
  });

  it('zeigt den Kundennamen bei einem ausgelagerten Stück', async () => {
    api.getSchmuckstueck.mockResolvedValue({ ...artikel, Ausgelagert: 1 });
    rendereMitToast(<SchmuckstueckDetailPanel artikelnummer="MHO001" onClose={() => {}} />);

    expect(await screen.findByText('Anna')).toBeInTheDocument();
  });

  it('zeigt einen Hinweis, wenn das Stück nicht gefunden wird', async () => {
    api.getSchmuckstueck.mockResolvedValue(null);
    rendereMitToast(<SchmuckstueckDetailPanel artikelnummer="MHO001" onClose={() => {}} />);

    expect(await screen.findByText('Schmuckstück nicht gefunden.')).toBeInTheDocument();
  });

  it('blendet Aktionen ohne Handler aus', async () => {
    rendereMitToast(<SchmuckstueckDetailPanel artikelnummer="MHO001" onClose={() => {}} />);
    await screen.findByText('Goldkette');

    expect(screen.queryByRole('button', { name: /Bearbeiten/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Duplizieren/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Löschen/ })).not.toBeInTheDocument();
  });

  it('ruft die Handler der Aktionen auf; Duplizieren bekommt das geladene Stück', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onDuplicate = vi.fn();
    rendereMitToast(
      <SchmuckstueckDetailPanel
        artikelnummer="MHO001"
        onClose={() => {}}
        onEdit={onEdit}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
      />,
    );
    await screen.findByText('Goldkette');

    fireEvent.click(screen.getByRole('button', { name: /Bearbeiten/ }));
    fireEvent.click(screen.getByRole('button', { name: /Löschen/ }));
    fireEvent.click(screen.getByRole('button', { name: /Duplizieren/ }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledWith(artikel);
  });

  it('lädt neu, wenn sich die Artikelnummer ändert', async () => {
    api.getSchmuckstueck.mockImplementation(async (nr) => ({ ...artikel, Artikelnummer: nr, Name: `Name ${nr}` }));
    const { rerender } = rendereMitToast(<SchmuckstueckDetailPanel artikelnummer="MHO001" onClose={() => {}} />);
    await screen.findByText('Name MHO001');

    rerender(
      <ToastProvider>
        <SchmuckstueckDetailPanel artikelnummer="MHO002" onClose={() => {}} />
      </ToastProvider>,
    );

    expect(await screen.findByText('Name MHO002')).toBeInTheDocument();
  });

  it('ruft onClose über den Schließen-Button und bei Ladefehler', async () => {
    const onClose = vi.fn();
    rendereMitToast(<SchmuckstueckDetailPanel artikelnummer="MHO001" onClose={onClose} schliessenLabel="Auswahl aufheben" />);
    await screen.findByText('Goldkette');

    fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('meldet einen Ladefehler per onClose', async () => {
    const onClose = vi.fn();
    api.getSchmuckstueck.mockRejectedValue(new Error('Netzwerkfehler'));
    rendereMitToast(<SchmuckstueckDetailPanel artikelnummer="MHO001" onClose={onClose} />);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('verwirft die späte Antwort eines früheren Stücks', async () => {
    let erste;
    api.getSchmuckstueck.mockImplementation((nr) =>
      nr === 'MHO001'
        ? new Promise((resolve) => (erste = resolve))
        : Promise.resolve({ ...artikel, Artikelnummer: nr, Name: `Name ${nr}` }),
    );
    const { rerender } = rendereMitToast(<SchmuckstueckDetailPanel artikelnummer="MHO001" onClose={() => {}} />);
    rerender(
      <ToastProvider>
        <SchmuckstueckDetailPanel artikelnummer="MHO002" onClose={() => {}} />
      </ToastProvider>,
    );
    await screen.findByText('Name MHO002');

    erste({ ...artikel, Name: 'Name MHO001' });

    await waitFor(() => expect(screen.getByText('Name MHO002')).toBeInTheDocument());
    expect(screen.queryByText('Name MHO001')).not.toBeInTheDocument();
  });
});
