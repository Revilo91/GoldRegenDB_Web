import { render, screen } from '@testing-library/react';
import React from 'react';
import Hilfe from '../pages/Hilfe';

describe('Hilfe', () => {
  it('zeigt die Etikettendrucker-Anleitung mit Überschriften und Tabelle', () => {
    render(<Hilfe />);
    expect(screen.getByRole('heading', { name: 'Hilfe' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Etikettendrucker Phomemo M220/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linux (CUPS)' })).toBeInTheDocument();
    expect(screen.getAllByRole('table').length).toBeGreaterThanOrEqual(2);
  });
});
