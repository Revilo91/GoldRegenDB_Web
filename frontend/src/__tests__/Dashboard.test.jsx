import { render, screen, within } from '@testing-library/react';
import Dashboard from '../pages/Dashboard';
import { api } from '../api';

vi.mock('../api', () => ({ api: { getDashboard: vi.fn() } }));

const statistik = {
  totalPieces: 100,
  inStockPieces: 40,
  outsourcedPieces: 30,
  soldPieces: 20,
  rejectPieces: 10,
  totalRevenue: '1234.50',
  activeCustomers: 7,
  totalCustomers: 9,
};

const daten = (abweichung = {}) => ({
  statistics: statistik,
  recentChanges: [],
  piecesByArt: [],
  piecesByKunde: [],
  statusDistribution: [],
  monthlyRevenueTrend: [],
  manufacturerStats: {
    M: { total: 60, verkauft: 12, ausgelagert: 18, verfuegbar: 25, ausschuss: 5, umsatz: '800.25' },
    S: { total: 40, verkauft: 8, ausgelagert: 12, verfuegbar: 15, ausschuss: 5, umsatz: '434.25' },
  },
  manufacturerByKunde: [],
  ...abweichung,
});

// Karte über ihre Beschriftung finden und den Wert daraus lesen.
const wertZu = (label, index = 0) =>
  screen.getAllByText(label)[index].parentElement.querySelector('.stat-value');

beforeEach(() => vi.clearAllMocks());

describe('Laden', () => {
  it('zeigt zuerst den Ladezustand', () => {
    api.getDashboard.mockReturnValue(new Promise(() => {}));
    render(<Dashboard />);

    expect(screen.getByText(/Lade Dashboard/)).toBeInTheDocument();
  });

  it('meldet einen API-Fehler mit Ursache', async () => {
    api.getDashboard.mockRejectedValue(new Error('Serverfehler 500'));
    render(<Dashboard />);

    expect(await screen.findByText(/Fehler beim Laden der Dashboard-Daten: Serverfehler 500/)).toBeInTheDocument();
  });

  it('nutzt einen Standardtext, wenn der Fehler keine Meldung trägt', async () => {
    api.getDashboard.mockRejectedValue(new Error(''));
    render(<Dashboard />);

    expect(
      await screen.findByText(/Die Dashboard-Daten konnten nicht geladen werden/),
    ).toBeInTheDocument();
  });

  it('behandelt eine leere Antwort als Fehler', async () => {
    api.getDashboard.mockResolvedValue(null);
    render(<Dashboard />);

    expect(await screen.findByText(/Fehler beim Laden der Dashboard-Daten\./)).toBeInTheDocument();
  });
});

describe('Kennzahlen', () => {
  it('zeigt die gelieferten Bestandszahlen unverändert an', async () => {
    api.getDashboard.mockResolvedValue(daten());
    render(<Dashboard />);
    await screen.findByText('Gesamt Stücke');

    expect(wertZu('Gesamt Stücke')).toHaveTextContent('100');
    expect(wertZu('Im Lager')).toHaveTextContent('40');
    expect(wertZu('Ausgelagert')).toHaveTextContent('30');
    expect(wertZu('Verkauft')).toHaveTextContent('20');
    expect(wertZu('Ausschuss')).toHaveTextContent('10');
    expect(wertZu('Aktive Kunden')).toHaveTextContent('7/9');
  });

  it('formatiert den vom Backend (nach Rabatt) gelieferten Umsatz als Euro, ohne ihn neu zu berechnen', async () => {
    api.getDashboard.mockResolvedValue(daten());
    render(<Dashboard />);
    await screen.findByText('Umsatz (verkauft)');

    expect(wertZu('Umsatz (verkauft)').textContent).toMatch(/^1\.234,50\s€$/);
  });

  it('zeigt Herstellerumsätze getrennt und ihre Summe entspricht dem Gesamtumsatz', async () => {
    api.getDashboard.mockResolvedValue(daten());
    render(<Dashboard />);

    const marina = (await screen.findByText('Marina (M)')).closest('.card');
    const saskia = screen.getByText('Saskia (S)').closest('.card');

    expect(within(marina).getByText(/^800,25\s€$/)).toBeInTheDocument();
    expect(within(saskia).getByText(/^434,25\s€$/)).toBeInTheDocument();
    expect(800.25 + 434.25).toBe(Number(statistik.totalRevenue));
    expect(within(marina).getByText('60')).toBeInTheDocument();
    expect(within(saskia).getByText('15')).toBeInTheDocument();
  });

  it('zeigt 0,00 EUR und Nullwerte, wenn keine Herstellerdaten vorliegen', async () => {
    api.getDashboard.mockResolvedValue(
      daten({ manufacturerStats: {}, statistics: { ...statistik, totalRevenue: 0 } }),
    );
    render(<Dashboard />);

    const marina = (await screen.findByText('Marina (M)')).closest('.card');

    expect(within(marina).getByText(/^0,00\s€$/)).toBeInTheDocument();
    expect(screen.getByText('Keine Hersteller-Daten vorhanden')).toBeInTheDocument();
    expect(wertZu('Umsatz (verkauft)').textContent).toMatch(/^0,00\s€$/);
  });

  it('zeigt bei fehlendem Umsatz (null) 0,00 EUR statt NaN', async () => {
    api.getDashboard.mockResolvedValue(daten({ statistics: { ...statistik, totalRevenue: null } }));
    render(<Dashboard />);
    await screen.findByText('Umsatz (verkauft)');

    expect(wertZu('Umsatz (verkauft)').textContent).toMatch(/^0,00\s€$/);
  });

  it('behandelt große Umsätze mit Tausendertrennzeichen', async () => {
    api.getDashboard.mockResolvedValue(
      daten({ statistics: { ...statistik, totalRevenue: '1234567.89' } }),
    );
    render(<Dashboard />);
    await screen.findByText('Umsatz (verkauft)');

    expect(wertZu('Umsatz (verkauft)').textContent).toMatch(/^1\.234\.567,89\s€$/);
  });
});

describe('Diagramme', () => {
  it('zeigt Leer-Hinweise, wenn keine Daten für die Diagramme vorliegen', async () => {
    api.getDashboard.mockResolvedValue(daten());
    render(<Dashboard />);

    expect(await screen.findByText('Keine ausgelagerten Stücke von Marina')).toBeInTheDocument();
    expect(screen.getByText('Keine ausgelagerten Stücke von Saskia')).toBeInTheDocument();
    expect(screen.getByText('Keine ausgelagerten Stücke')).toBeInTheDocument();
    expect(screen.getByText('Noch keine Umsatzdaten vorhanden')).toBeInTheDocument();
    expect(screen.getAllByText('Keine Daten vorhanden')).toHaveLength(2);
  });

  it('blendet die Leer-Hinweise aus, sobald Daten vorhanden sind', async () => {
    api.getDashboard.mockResolvedValue(
      daten({
        piecesByArt: [{ Art: 'Ohrring', count: 5 }],
        piecesByKunde: [{ Name: 'Laden A', count: 3 }],
        statusDistribution: [
          { name: 'Im Lager', value: 40, percentage: 40 },
          { name: 'Verkauft', value: 20, percentage: 20 },
        ],
        monthlyRevenueTrend: [{ monat: '2026-01', marinaUmsatz: '10.00', saskiaUmsatz: '5.50' }],
        manufacturerByKunde: [
          { hersteller: 'M', kunde: 'Laden A', anzahl: 2 },
          { hersteller: 'S', kunde: 'Laden B', anzahl: 1 },
        ],
      }),
    );
    render(<Dashboard />);
    await screen.findByText('Monatlicher Umsatztrend');

    expect(screen.queryByText('Keine Daten vorhanden')).not.toBeInTheDocument();
    expect(screen.queryByText('Keine ausgelagerten Stücke')).not.toBeInTheDocument();
    expect(screen.queryByText('Noch keine Umsatzdaten vorhanden')).not.toBeInTheDocument();
    expect(screen.queryByText('Keine ausgelagerten Stücke von Marina')).not.toBeInTheDocument();
    expect(screen.queryByText('Keine ausgelagerten Stücke von Saskia')).not.toBeInTheDocument();
  });

  it('bietet die drei Umsatztrend-Ansichten an', async () => {
    api.getDashboard.mockResolvedValue(daten());
    render(<Dashboard />);
    await screen.findByText('Monatlicher Umsatztrend');

    for (const name of ['Gesamt', 'Hersteller', 'Alle']) {
      const knopf = screen.getByRole('button', { name });
      knopf.click();
      expect(knopf).toBeInTheDocument();
    }
  });
});
