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

  it('zeigt ohne Auswahl den Hinweis auf das Musteretikett', async () => {
    render(<Etiketten />);

    expect(
      await screen.findByText(/Musteretikett/),
    ).toBeInTheDocument();
  });
});
