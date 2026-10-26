import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import DataTable from '../components/DataTable';
import { mockeBreite } from './helpers/matchMedia';

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

describe('DataTable: mobileRow (Kompakt-Liste)', () => {
  const mobileRow = (row) => <span>Zeile {row.name}</span>;

  afterEach(() => {
    delete window.matchMedia;
  });

  it('zeigt bei schmaler Breite die Liste statt der Tabelle', () => {
    mockeBreite(390);
    render(<DataTable columns={columns} data={data} mobileRow={mobileRow} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Zeile Banane')).toBeInTheDocument();
  });

  it('zeigt bei großer Breite weiter die Tabelle', () => {
    mockeBreite(1200);
    render(<DataTable columns={columns} data={data} mobileRow={mobileRow} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('ohne mobileRow bleibt es bei der Tabelle, auch bei schmaler Breite', () => {
    mockeBreite(390);
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('löst onRowClick mit der Zeile aus (Klick und Tastatur)', () => {
    mockeBreite(390);
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={data} mobileRow={mobileRow} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('Zeile Apfel'));
    expect(onRowClick).toHaveBeenCalledWith(data[1]);
    fireEvent.keyDown(screen.getAllByRole('button')[2], { key: 'Enter' });
    expect(onRowClick).toHaveBeenLastCalledWith(data[2]);
  });

  it('übernimmt die Standardsortierung und getRowKey', () => {
    mockeBreite(390);
    render(
      <DataTable
        columns={columns}
        data={data}
        mobileRow={mobileRow}
        defaultSort={{ key: 'name', direction: 'asc' }}
        getRowKey={(r) => `k${r.id}`}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Apfel');
    expect(items[2]).toHaveTextContent('Kirsche');
  });

  it('wechselt beim Ändern der Breite zwischen Liste und Tabelle', () => {
    const fenster = mockeBreite(1200);
    render(<DataTable columns={columns} data={data} mobileRow={mobileRow} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    act(() => fenster.setze(390));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('DataTable: Zeilenklasse und Reihenfolge-Meldung', () => {
  it('hängt eine className aus rowProps an die Zeilenklasse, statt sie zu ersetzen', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        onRowClick={() => {}}
        rowProps={(r) => (r.id === 2 ? { className: 'aktiv', 'aria-current': 'true' } : {})}
      />,
    );

    const zeilen = screen.getAllByRole('row').slice(1);
    expect(zeilen[1]).toHaveClass('aktiv', 'data-table-row-pointer');
    expect(zeilen[1]).toHaveAttribute('aria-current', 'true');
    expect(zeilen[0]).not.toHaveClass('aktiv');
  });

  it('meldet die sichtbare Reihenfolge der Zeilenschlüssel, auch nach dem Sortieren', () => {
    const onSortedChange = vi.fn();
    render(<DataTable columns={columns} data={data} getRowKey={(r) => r.id} onSortedChange={onSortedChange} />);
    expect(onSortedChange).toHaveBeenLastCalledWith([1, 2, 3]);

    fireEvent.click(screen.getByText(/Menge/));

    expect(onSortedChange).toHaveBeenLastCalledWith([3, 1, 2]);
  });

  it('meldet bei unveränderter Reihenfolge nichts erneut, auch wenn columns bei jedem Render neu ist', () => {
    const onSortedChange = vi.fn();
    const { rerender } = render(
      <DataTable columns={[...columns]} data={data} getRowKey={(r) => r.id} onSortedChange={onSortedChange} />,
    );
    rerender(<DataTable columns={[...columns]} data={data} getRowKey={(r) => r.id} onSortedChange={onSortedChange} />);

    expect(onSortedChange).toHaveBeenCalledTimes(1);
  });
});
