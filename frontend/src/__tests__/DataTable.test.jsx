import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DataTable from '../components/DataTable';

const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'menge', label: 'Menge', sortable: true },
];

const data = [
  { id: 1, name: 'Banane', menge: 5 },
  { id: 2, name: 'Apfel', menge: 20 },
  { id: 3, name: 'Kirsche', menge: 3 },
];

describe('DataTable', () => {
  it('rendert Spaltenüberschriften und alle Zeilen', () => {
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByText(/Name/)).toBeInTheDocument();
    expect(screen.getByText(/Menge/)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4); // 1 Header + 3 Daten
  });

  it('sortiert numerisch beim Klick auf eine sortierbare Spalte', () => {
    render(<DataTable columns={columns} data={data} />);

    fireEvent.click(screen.getByText(/Menge/));

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Kirsche');
    expect(rows[1]).toHaveTextContent('Banane');
    expect(rows[2]).toHaveTextContent('Apfel');
  });

  it('kehrt die Sortierrichtung bei erneutem Klick um', () => {
    render(<DataTable columns={columns} data={data} />);

    const header = screen.getByText(/Menge/);
    fireEvent.click(header);
    fireEvent.click(header);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Apfel');
    expect(rows[2]).toHaveTextContent('Kirsche');
  });

  it('sortiert Text alphabetisch statt nach Einfügereihenfolge', () => {
    render(<DataTable columns={columns} data={data} />);

    fireEvent.click(screen.getByText(/^Name/));

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Apfel');
    expect(rows[1]).toHaveTextContent('Banane');
    expect(rows[2]).toHaveTextContent('Kirsche');
  });

  it('ruft onRowClick mit der geklickten Zeile auf', () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={data} onRowClick={onRowClick} />);

    fireEvent.click(screen.getByText('Apfel'));

    expect(onRowClick).toHaveBeenCalledWith(data[1]);
  });

  it('rendert ohne Daten eine leere Tabelle ohne Fehler', () => {
    render(<DataTable columns={columns} data={[]} />);

    expect(screen.getAllByRole('row')).toHaveLength(1); // nur Header
  });
});
