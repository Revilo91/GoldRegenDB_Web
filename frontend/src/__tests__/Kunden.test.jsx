import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import Kunden from '../pages/Kunden';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getKunden: vi.fn(),
    createKunde: vi.fn(),
    updateKunde: vi.fn(),
    deleteKunde: vi.fn(),
  },
}));

const kunden = [
  { ID: 1, Name: 'Anna Laden', Ort: 'Köln', PLZ: 50667, Email: 'anna@example.org', Provision: 30, Aktiv: true, Direktverkauf: false },
  { ID: 2, Name: 'Bernd Markt', Ort: 'Bonn', PLZ: 53111, Email: 'bernd@example.org', Provision: 25, Aktiv: true, Direktverkauf: true },
  { ID: 3, Name: 'Alt Kunde', Ort: 'Essen', PLZ: 45127, Email: '', Provision: 0, Aktiv: false, Direktverkauf: false },
];

// Eingabefeld im Modal über die Beschriftung finden (Labels sind nicht per for/id verknüpft).
const feld = (label) => {
  const modal = document.querySelector('.modal');
  return within(modal).getByText(label).parentElement.querySelector('input');
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  api.getKunden.mockResolvedValue(kunden);
});

afterEach(() => vi.restoreAllMocks());

describe('Liste', () => {
  it('zeigt standardmäßig nur aktive Kunden mit Ort, PLZ, Provision und Direktverkauf-Kennzeichen', async () => {
    rendereMitToast(<Kunden />);

    expect(await screen.findByText('Anna Laden')).toBeInTheDocument();
    expect(screen.queryByText('Alt Kunde')).not.toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('53111')).toBeInTheDocument();
    expect(screen.getByText('Direktverkauf')).toBeInTheDocument();
    expect(screen.getByText('3 Kunden / Händler')).toBeInTheDocument();
  });

  it('zeigt Inaktive, wenn der Statusfilter auf "Inaktiv" steht', async () => {
    rendereMitToast(<Kunden />);
    await screen.findByText('Anna Laden');

    fireEvent.change(screen.getByDisplayValue('Aktiv'), { target: { value: '0' } });

    expect(screen.getByText('Alt Kunde')).toBeInTheDocument();
    expect(screen.queryByText('Anna Laden')).not.toBeInTheDocument();
  });

  it('zeigt alle Kunden ohne Statusfilter', async () => {
    rendereMitToast(<Kunden />);
    await screen.findByText('Anna Laden');

    fireEvent.change(screen.getByDisplayValue('Aktiv'), { target: { value: '' } });

    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it.each([
    ['name', 'anna laden', 'Anna Laden'],
    ['ort', 'BONN', 'Bernd Markt'],
    ['email', 'bernd@', 'Bernd Markt'],
  ])('sucht nach %s ohne Beachtung der Groß-/Kleinschreibung', async (_feld, suche, treffer) => {
    rendereMitToast(<Kunden />);
    await screen.findByText('Anna Laden');

    fireEvent.change(screen.getByPlaceholderText(/Suche nach Name/), { target: { value: suche } });

    expect(screen.getByText(treffer)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('zeigt nur die Kopfzeile, wenn nichts passt', async () => {
    rendereMitToast(<Kunden />);
    await screen.findByText('Anna Laden');

    fireEvent.change(screen.getByPlaceholderText(/Suche nach Name/), { target: { value: 'gibtesnicht' } });

    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('meldet Ladefehler per Toast', async () => {
    api.getKunden.mockRejectedValue(new Error('Server weg'));
    rendereMitToast(<Kunden />);

    expect(await screen.findByText('Fehler beim Laden der Kunden: Server weg')).toBeInTheDocument();
  });
});

describe('Anlegen', () => {
  it('öffnet ein leeres Formular mit den Standardwerten und legt den Kunden an', async () => {
    api.createKunde.mockResolvedValue({});
    rendereMitToast(<Kunden />);
    await screen.findByText('Anna Laden');

    fireEvent.click(screen.getByRole('button', { name: '+ Neuer Kunde' }));

    expect(screen.getByText('Neuer Kunde')).toBeInTheDocument();
    expect(feld('Land (ISO-Code)')).toHaveValue('DE');
    fireEvent.change(feld('Name'), { target: { value: 'Neu GmbH' } });
    fireEvent.change(feld('Land (ISO-Code)'), { target: { value: 'at' } });
    fireEvent.change(feld('Provision (%)'), { target: { value: '15' } });
    fireEvent.click(feld('Aktiv'));
    fireEvent.click(screen.getByLabelText(/Direktverkauf \(ohne Lieferschein\)/));
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(api.createKunde).toHaveBeenCalled());
    expect(api.createKunde).toHaveBeenCalledWith(
      expect.objectContaining({ Name: 'Neu GmbH', Land: 'AT', Provision: 15, Aktiv: true, Direktverkauf: true }),
    );
    await waitFor(() => expect(api.getKunden).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Neuer Kunde')).not.toBeInTheDocument();
  });

  it('zeigt Fehler des Servers und lässt das Formular offen', async () => {
    api.createKunde.mockRejectedValue(new Error('Name bereits vergeben'));
    rendereMitToast(<Kunden />);
    await screen.findByText('Anna Laden');

    fireEvent.click(screen.getByRole('button', { name: '+ Neuer Kunde' }));
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }));

    expect(await screen.findByText('Name bereits vergeben')).toBeInTheDocument();
    expect(screen.getByText('Neuer Kunde')).toBeInTheDocument();
  });

  it('schließt das Formular über Abbrechen ohne API-Aufruf', async () => {
    rendereMitToast(<Kunden />);
    await screen.findByText('Anna Laden');

    fireEvent.click(screen.getByRole('button', { name: '+ Neuer Kunde' }));
    fireEvent.click(screen.getByRole('button', { name: /Abbrechen/ }));

    expect(screen.queryByText('Neuer Kunde')).not.toBeInTheDocument();
    expect(api.createKunde).not.toHaveBeenCalled();
  });
});

describe('Bearbeiten und Löschen', () => {
  async function oeffneAnna() {
    rendereMitToast(<Kunden />);
    fireEvent.click(await screen.findByText('Anna Laden'));
    await screen.findByText('Kunde bearbeiten');
  }

  it('füllt das Formular mit den Kundendaten und speichert per Update', async () => {
    api.updateKunde.mockResolvedValue({});
    await oeffneAnna();

    expect(feld('Name')).toHaveValue('Anna Laden');
    expect(feld('Ort')).toHaveValue('Köln');
    expect(feld('Provision (%)')).toHaveValue(30);
    fireEvent.change(feld('Provision (%)'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }));

    await waitFor(() =>
      expect(api.updateKunde).toHaveBeenCalledWith(1, expect.objectContaining({ ID: 1, Name: 'Anna Laden', Provision: 35 })),
    );
    expect(api.createKunde).not.toHaveBeenCalled();
  });

  it('löscht nach Bestätigung', async () => {
    api.deleteKunde.mockResolvedValue({});
    await oeffneAnna();

    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(api.deleteKunde).toHaveBeenCalledWith(1));
    expect(window.confirm).toHaveBeenCalledWith('Kunde wirklich löschen?');
    await waitFor(() => expect(api.getKunden).toHaveBeenCalledTimes(2));
  });

  it('löscht nichts, wenn die Bestätigung abgelehnt wird', async () => {
    window.confirm.mockReturnValue(false);
    await oeffneAnna();

    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

    expect(api.deleteKunde).not.toHaveBeenCalled();
  });

  it('meldet Löschfehler (z. B. Kunde hat Belege) per Toast', async () => {
    api.deleteKunde.mockRejectedValue(new Error('Kunde hat noch Lieferscheine'));
    await oeffneAnna();

    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

    expect(await screen.findByText('Kunde hat noch Lieferscheine')).toBeInTheDocument();
  });
});
