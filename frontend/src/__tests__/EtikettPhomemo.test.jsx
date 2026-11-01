import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import Etiketten from '../pages/Etiketten';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getEtikettenSizes: vi.fn(),
    getEtikettenOptions: vi.fn(),
    getEtikettenPreview: vi.fn(),
  },
}));

describe('Etiketten', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getEtikettenSizes.mockResolvedValue({
      defaultSize: 'small',
      sizes: [
        { id: 'small', name: 'Klein', w: 30, h: 20, rotate: false, showQr: false },
        { id: 'large', name: 'Groß', w: 40, h: 30, rotate: true, showQr: true },
      ],
    });
    api.getEtikettenOptions.mockResolvedValue([
      { artikelnummer: 'ART001', name: 'Test Artikel' },
    ]);
    api.getEtikettenPreview.mockResolvedValue('<html><body>preview</body></html>');
  });

  it('lädt die Etikettengrößen aus dem Backend', async () => {
    render(<Etiketten />);

    expect(await screen.findByText('Klein')).toBeInTheDocument();
    expect(screen.getAllByText('30 × 20 mm').length).toBeGreaterThan(0);
    expect(screen.getByText('ohne QR-Code')).toBeInTheDocument();
    expect(screen.getByText('mit QR-Code · gedreht')).toBeInTheDocument();
  });

  it('fügt einen eigenen Hinweis mit Enter hinzu und entfernt ihn per Klick', async () => {
    render(<Etiketten />);

    const input = await screen.findByPlaceholderText('Eigener Hinweis');
    fireEvent.change(input, { target: { value: 'Neu' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    const chip = await screen.findByLabelText('Hinweis Neu entfernen');
    fireEvent.click(chip);

    await waitFor(() =>
      expect(screen.queryByLabelText('Hinweis Neu entfernen')).not.toBeInTheDocument(),
    );
  });

  it('übernimmt Artikel in die Druckliste und summiert die Anzahl', async () => {
    render(<Etiketten />);

    const addButton = await screen.findByRole('button', { name: 'Übernehmen' });
    const qtyInput = screen.getByLabelText('Anzahl für ART001');
    fireEvent.change(qtyInput, { target: { value: '3' } });
    fireEvent.click(addButton);

    expect(await screen.findByText('3 Etiketten gesamt')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '3 Etiketten drucken' }),
    ).toBeEnabled();
  });

  it('zeigt Gesamtzahl und Anzahl der Artikeltypen an', async () => {
    render(<Etiketten />);

    const addButton = await screen.findByRole('button', { name: 'Übernehmen' });
    const qtyInput = screen.getByLabelText('Anzahl für ART001');
    fireEvent.change(qtyInput, { target: { value: '4' } });
    fireEvent.click(addButton);

    expect(await screen.findByText('4 Etiketten · 1 Typen')).toBeInTheDocument();
    expect(screen.getByText('Artikeltyp')).toBeInTheDocument();
    expect(screen.getByText('Etiketten im Druck')).toBeInTheDocument();
  });

  it('fordert die Vorschau als einzelnes Etikett an', async () => {
    render(<Etiketten />);

    await waitFor(() => expect(api.getEtikettenPreview).toHaveBeenCalled());
    const payload = api.getEtikettenPreview.mock.calls[0][0];
    expect(payload.mode).toBe('single');
    expect(payload.labelSize).toBe('small');
  });

  describe('Zuletzt erstellt', () => {
    const zuletzt = [
      { artikelnummer: 'NEU002', name: 'Neueste Kette' },
      { artikelnummer: 'ALT001', name: 'Ältere Kette' },
    ];

    it('lädt Vorschläge nicht automatisch', async () => {
      render(<Etiketten />);

      await screen.findByText('ART001');
      expect(
        api.getEtikettenOptions.mock.calls.some(([p]) => p?.sort === 'zuletzt'),
      ).toBe(false);
      expect(screen.queryByLabelText('NEU002 übernehmen')).not.toBeInTheDocument();
    });

    it('lädt per Klick die letzten 20 Basisnummern und zeigt sie an', async () => {
      api.getEtikettenOptions.mockImplementation((params) =>
        Promise.resolve(params?.sort === 'zuletzt'
          ? zuletzt
          : [{ artikelnummer: 'ART001', name: 'Test Artikel' }]),
      );
      render(<Etiketten />);

      fireEvent.click(await screen.findByRole('button', { name: 'Zuletzt erstellt' }));

      expect(await screen.findByLabelText('NEU002 übernehmen')).toBeInTheDocument();
      expect(screen.getByLabelText('ALT001 übernehmen')).toBeInTheDocument();
      expect(api.getEtikettenOptions).toHaveBeenCalledWith({
        sort: 'zuletzt',
        limit: '20',
      });
    });

    it('übernimmt einen Vorschlag erst per Klick mit Menge 1', async () => {
      api.getEtikettenOptions.mockImplementation((params) =>
        Promise.resolve(params?.sort === 'zuletzt' ? zuletzt : []),
      );
      render(<Etiketten />);

      fireEvent.click(await screen.findByRole('button', { name: 'Zuletzt erstellt' }));
      const vorschlag = await screen.findByLabelText('NEU002 übernehmen');
      expect(screen.getByText('Noch keine Artikel in der Druckliste.')).toBeInTheDocument();

      fireEvent.click(vorschlag);

      expect(await screen.findByText('1 Etiketten · 1 Typen')).toBeInTheDocument();
    });

    it('zeigt einen Hinweis, wenn keine verfügbaren Stücke vorhanden sind', async () => {
      api.getEtikettenOptions.mockResolvedValue([]);
      render(<Etiketten />);

      fireEvent.click(await screen.findByRole('button', { name: 'Zuletzt erstellt' }));

      expect(
        await screen.findByText('Keine verfügbaren Stücke gefunden'),
      ).toBeInTheDocument();
    });

    it('meldet Ladefehler im Fehlerbereich der Seite', async () => {
      api.getEtikettenOptions.mockImplementation((params) =>
        params?.sort === 'zuletzt'
          ? Promise.reject(new Error('Server nicht erreichbar'))
          : Promise.resolve([]),
      );
      render(<Etiketten />);

      fireEvent.click(await screen.findByRole('button', { name: 'Zuletzt erstellt' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Server nicht erreichbar');
    });

    it('blendet die Vorschläge per zweitem Klick wieder aus', async () => {
      api.getEtikettenOptions.mockImplementation((params) =>
        Promise.resolve(params?.sort === 'zuletzt' ? zuletzt : []),
      );
      render(<Etiketten />);

      const button = await screen.findByRole('button', { name: 'Zuletzt erstellt' });
      fireEvent.click(button);
      await screen.findByLabelText('NEU002 übernehmen');
      fireEvent.click(button);

      expect(screen.queryByLabelText('NEU002 übernehmen')).not.toBeInTheDocument();
    });
  });

  it('zeigt ohne Auswahl den Hinweis auf das Musteretikett', async () => {
    render(<Etiketten />);

    expect(
      await screen.findByText(/Musteretikett/),
    ).toBeInTheDocument();
  });
});
