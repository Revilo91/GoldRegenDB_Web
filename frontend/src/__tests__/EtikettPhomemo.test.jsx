import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import EtikettPhomemo from '../pages/EtikettPhomemo';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getEtikettenOptions: vi.fn(),
    getEtikettenPreview: vi.fn(),
  },
}));

describe('EtikettPhomemo', () => {
  beforeEach(() => {
    api.getEtikettenOptions.mockResolvedValue([
      { artikelnummer: 'ART001_1', name: 'Test Artikel' },
    ]);
    api.getEtikettenPreview.mockResolvedValue('<div>preview</div>');
  });

  it('fügt eigenen Hinweis mit Enter hinzu und entfernt ihn', async () => {
    render(<EtikettPhomemo />);

    // wait for options to load
    await waitFor(() => expect(screen.getByText('Verfügbare Artikel')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('Eigener Hinweis');
    fireEvent.change(input, { target: { value: 'Neu' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('Neu')).toBeInTheDocument();

    const removeBtn = screen.getByLabelText('Hinweis Neu entfernen');
    fireEvent.click(removeBtn);

    await waitFor(() => expect(screen.queryByText('Neu')).not.toBeInTheDocument());
  });
});
