import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { rendereMitToast } from './helpers/rendern';
import Schmuckstuecke from '../pages/Schmuckstuecke';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { mockeBreite } from './helpers/matchMedia';

vi.mock('../api', () => ({
  api: {
    getFilterOptions: vi.fn(),
    getKunden: vi.fn(),
    getSchmuckstuecke: vi.fn(),
    getStatusZahlen: vi.fn(),
    getSchmuckstueck: vi.fn(),
    getNextArtikelnummer: vi.fn(),
    createSchmuckstueckeBulk: vi.fn(),
    deleteFoto: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
// Meldet pauseLoading als Attribut, damit die Tests prüfen können, wann Fotos pausieren.
vi.mock('../components/TablePhoto', () => ({
  default: ({ pauseLoading }) => <i data-testid="tablephoto" data-pause={String(Boolean(pauseLoading))} />,
}));
// Stellvertreter für den Upload: zeigt die übergebene Nummer und meldet auf Klick ein Foto.
vi.mock('../components/PhotoUpload', () => ({
  default: ({ artikelnummer, disabled, onPhotoSelected }) => (
    <button disabled={disabled} onClick={() => onPhotoSelected('pfad')}>
      Foto für {artikelnummer}
    </button>
  ),
}));

// Gemeinsamer Aufbau für alle Tests der Seite: API-Mocks, Rolle und Rendern.
function rendereSeite(rolle = 'bearbeiter') {
  useAuth.mockReturnValue({ user: { username: 'test', role: rolle } });
  return rendereMitToast(
    <MemoryRouter>
      <Schmuckstuecke />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getFilterOptions.mockResolvedValue({ grundmaterialien: [], produktarten: [] });
  api.getKunden.mockResolvedValue([]);
  api.getSchmuckstuecke.mockResolvedValue({ data: [], pagination: { total: 0 } });
  api.getStatusZahlen.mockResolvedValue({ alle: 0, lager: 0, ausgelagert: 0, verkauft: 0, ausschuss: 0 });
  api.deleteFoto.mockResolvedValue({ message: 'Foto gelöscht' });
});

describe('Aus Vorlage anlegen', () => {
  it('zeigt Bearbeitern den Button "+ Aus Vorlage anlegen" statt "nachtragen"', async () => {
    rendereSeite('bearbeiter');

    expect(await screen.findByRole('button', { name: '+ Aus Vorlage anlegen' })).toBeInTheDocument();
    expect(screen.queryByText(/nachtragen/)).not.toBeInTheDocument();
  });

  it('öffnet beim Klick das Modal "Schmuckstücke aus Vorlage anlegen"', async () => {
    rendereSeite('admin');

    fireEvent.click(await screen.findByRole('button', { name: '+ Aus Vorlage anlegen' }));

    expect(
      screen.getByRole('heading', { name: 'Schmuckstücke aus Vorlage anlegen' }),
    ).toBeInTheDocument();
  });

  it('blendet den Button für die Rolle user aus', async () => {
    rendereSeite('user');

    await screen.findByRole('button', { name: '+ Neues Schmuckstück' });
    expect(screen.queryByRole('button', { name: '+ Aus Vorlage anlegen' })).not.toBeInTheDocument();
  });
});

describe('Vorlage laden: neue Artikelnummer', () => {
  const vorlage = (artikelnummer, extra = {}) => ({
    Artikelnummer: artikelnummer,
    Name: 'Tropfen',
    Art: 'Ohrring',
    Material: 'Harz',
    Farbe: 'Blau',
    Verkaufspreis: 24.5,
    Herstellungskosten: 9.5,
    Form: 'Rund',
    Fassung: 'Silber',
    ...extra,
  });

  async function oeffneModal(rolle = 'bearbeiter') {
    rendereSeite(rolle);
    fireEvent.click(await screen.findByRole('button', { name: '+ Aus Vorlage anlegen' }));
  }

  async function ladeVorlage(artikelnummer) {
    fireEvent.change(screen.getByPlaceholderText('z.B. MBH001_1'), {
      target: { value: artikelnummer },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Als neue Zeile übernehmen' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Als neue Zeile übernehmen' })).toBeEnabled(),
    );
  }

  beforeEach(() => {
    api.getSchmuckstueck.mockImplementation(async (nr) => vorlage(nr));
    api.getNextArtikelnummer.mockResolvedValue({
      prefix: 'MHO',
      nextNum: 127,
      artikelnummer: 'MHO127',
    });
    api.createSchmuckstueckeBulk.mockResolvedValue({ createdCount: 1 });
  });

  it('vergibt eine neue Laufnummer und übernimmt die sichtbaren Felder', async () => {
    await oeffneModal();
    await ladeVorlage('MHO123_1');

    expect(api.getNextArtikelnummer).toHaveBeenCalledWith('MHO');
    const nummernfelder = screen.getAllByPlaceholderText('MBH001_2');
    expect(nummernfelder.map((f) => f.value)).toEqual(['MHO127_1']);
    expect(screen.getByDisplayValue('Tropfen')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ohrring')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Harz')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Blau')).toBeInTheDocument();
    expect(screen.getByDisplayValue('24.5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Rund')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Silber')).toBeInTheDocument();
  });

  it('zählt bei einer zweiten Vorlage mit gleichem Präfix hoch', async () => {
    await oeffneModal();
    await ladeVorlage('MHO123_1');
    await ladeVorlage('MHO124_1');

    const nummernfelder = screen.getAllByPlaceholderText('MBH001_2');
    expect(nummernfelder.map((f) => f.value)).toEqual(['MHO127_1', 'MHO128_1']);
  });

  it('klont alle Felder der Vorlage, auch die in der Tabelle nicht sichtbaren', async () => {
    api.getSchmuckstueck.mockImplementation(async (nr) =>
      vorlage(nr, {
        Länge: 45,
        Inhalt_Material: 'Blüten',
        Anhänger_Form: 'Tropfen',
        Zwischenstück: 'Perle',
        Ausschuss_Grund: '',
      }),
    );
    await oeffneModal();
    await ladeVorlage('MHO123_1');

    fireEvent.click(screen.getByRole('button', { name: 'Mehrfach speichern' }));

    await waitFor(() => expect(api.createSchmuckstueckeBulk).toHaveBeenCalledTimes(1));
    const { items } = api.createSchmuckstueckeBulk.mock.calls[0][0];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      Artikelnummer: 'MHO127_1',
      Name: 'Tropfen',
      Verkaufspreis: 24.5,
      Herstellungskosten: 9.5,
      Länge: 45,
      Inhalt_Material: 'Blüten',
      Anhänger_Form: 'Tropfen',
      Zwischenstück: 'Perle',
    });
  });

  it('übernimmt keine Identitäts-, Beleg- oder Statusfelder der Vorlage', async () => {
    api.getSchmuckstueck.mockImplementation(async (nr) =>
      vorlage(nr, {
        ID: 99,
        Erstelldatum: '2025-01-01',
        Letzte_Änderung: '2025-02-01',
        Lieferschein_ID: 7,
        Rechnung_ID: 8,
        Ausgelagert: 3,
        Verkauft: true,
        Ausschuss: true,
        Ausschuss_Grund: 'defekt',
        hatFoto: true,
      }),
    );
    await oeffneModal();
    await ladeVorlage('MHO123_1');

    fireEvent.click(screen.getByRole('button', { name: 'Mehrfach speichern' }));

    await waitFor(() => expect(api.createSchmuckstueckeBulk).toHaveBeenCalledTimes(1));
    const [item] = api.createSchmuckstueckeBulk.mock.calls[0][0].items;
    for (const feld of [
      'ID',
      'Erstelldatum',
      'Letzte_Änderung',
      'Lieferschein_ID',
      'Rechnung_ID',
      'Ausgelagert',
      'Verkauft',
      'Ausschuss',
      'Ausschuss_Grund',
      'hatFoto',
    ]) {
      expect(item).not.toHaveProperty(feld);
    }
  });

  it('meldet das erfolgreiche Anlegen als Erfolg, nicht als Fehler', async () => {
    await oeffneModal();
    await ladeVorlage('MHO123_1');

    fireEvent.click(screen.getByRole('button', { name: 'Mehrfach speichern' }));

    const meldung = await screen.findByText('1 Schmuckstücke wurden erfolgreich angelegt.');
    expect(meldung.closest('.toast')).toHaveClass('toast-erfolg');
  });

  it('fügt bei Fehler der Nummernvergabe eine Zeile ohne Artikelnummer ein und zeigt einen Fehlertoast', async () => {
    api.getNextArtikelnummer.mockRejectedValue(new Error('Server nicht erreichbar'));
    await oeffneModal();
    await ladeVorlage('MHO123_1');

    expect(await screen.findByText(/Server nicht erreichbar/)).toBeInTheDocument();
    const nummernfelder = screen.getAllByPlaceholderText('MBH001_2');
    expect(nummernfelder.map((f) => f.value)).toEqual(['']);
    expect(screen.getByDisplayValue('Tropfen')).toBeInTheDocument();
  });
});

describe('Zeile mit allen Feldern bearbeiten', () => {
  const vorlage = (artikelnummer) => ({
    Artikelnummer: artikelnummer,
    Name: 'Tropfen',
    Art: 'Ohrring',
    Material: 'Harz',
    Farbe: 'Blau',
    Verkaufspreis: 24.5,
    Herstellungskosten: 9.5,
    Länge: 45,
    Inhalt_Material: 'Blüten',
  });

  async function ladeVorlageUndOeffneZeile() {
    rendereSeite();
    fireEvent.click(await screen.findByRole('button', { name: '+ Aus Vorlage anlegen' }));
    fireEvent.change(screen.getByPlaceholderText('z.B. MBH001_1'), {
      target: { value: 'MHO123_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Als neue Zeile übernehmen' }));
    await waitFor(() => expect(screen.getAllByPlaceholderText('MBH001_2')[0].value).toBe('MHO127_1'));
    const knoepfe = screen.getAllByTitle('Alle Felder bearbeiten');
    fireEvent.click(knoepfe[knoepfe.length - 1]);
  }

  async function speichereMehrfach() {
    fireEvent.click(screen.getByRole('button', { name: 'Mehrfach speichern' }));
    await waitFor(() => expect(api.createSchmuckstueckeBulk).toHaveBeenCalledTimes(1));
    return api.createSchmuckstueckeBulk.mock.calls[0][0].items[0];
  }

  beforeEach(() => {
    api.getSchmuckstueck.mockImplementation(async (nr) => vorlage(nr));
    api.getNextArtikelnummer.mockResolvedValue({ prefix: 'MHO', nextNum: 127, artikelnummer: 'MHO127' });
    api.createSchmuckstueckeBulk.mockResolvedValue({ createdCount: 1 });
  });

  it('öffnet das Formular mit den geklonten Werten und gesperrter Artikelnummer', async () => {
    await ladeVorlageUndOeffneZeile();

    expect(await screen.findByRole('heading', { name: /MHO127_1/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('45')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Blüten')).toBeInTheDocument();
    const nummer = screen.getAllByDisplayValue('MHO127_1').find((f) => f.disabled);
    expect(nummer).toBeDefined();
  });

  it('übernimmt Änderungen aus dem Formular in die Zeile', async () => {
    await ladeVorlageUndOeffneZeile();

    fireEvent.change(await screen.findByDisplayValue('45'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    expect(screen.queryByRole('button', { name: 'Übernehmen' })).not.toBeInTheDocument();
    const item = await speichereMehrfach();
    expect(item).toMatchObject({ Artikelnummer: 'MHO127_1', Länge: 60, Inhalt_Material: 'Blüten' });
  });

  it('verwirft Änderungen bei Abbrechen', async () => {
    await ladeVorlageUndOeffneZeile();

    fireEvent.change(await screen.findByDisplayValue('45'), { target: { value: '60' } });
    const abbrechen = screen.getAllByRole('button', { name: 'Abbrechen' });
    fireEvent.click(abbrechen[abbrechen.length - 1]);

    const item = await speichereMehrfach();
    expect(item.Länge).toBe(45);
  });

  it('bietet den Foto-Upload mit der Artikelnummer der Zeile an, ohne Statusfelder', async () => {
    await ladeVorlageUndOeffneZeile();

    expect(await screen.findByRole('button', { name: 'Foto für MHO127_1' })).toBeEnabled();
    // Der Status-Chip "Ausschuss" liegt außerhalb des Modals und zählt nicht.
    expect(within(document.querySelector('.modal')).queryByText('Ausschuss')).not.toBeInTheDocument();
  });

  it('merkt sich das Foto an der Zeile, schickt hatFoto aber nicht an den Server', async () => {
    await ladeVorlageUndOeffneZeile();

    fireEvent.click(await screen.findByRole('button', { name: 'Foto für MHO127_1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    const item = await speichereMehrfach();
    expect(item).not.toHaveProperty('hatFoto');
    expect(item).not.toHaveProperty('fotoArtikelnummer');
  });

  async function ladeFotoInZeilenFormular() {
    await ladeVorlageUndOeffneZeile();
    fireEvent.click(await screen.findByRole('button', { name: 'Foto für MHO127_1' }));
  }

  function klickeLetztenAbbrechen() {
    const knoepfe = screen.getAllByRole('button', { name: 'Abbrechen' });
    fireEvent.click(knoepfe[knoepfe.length - 1]);
  }

  it('löscht das Foto wieder, wenn das Zeilen-Formular abgebrochen wird', async () => {
    await ladeFotoInZeilenFormular();

    klickeLetztenAbbrechen();

    await waitFor(() => expect(api.deleteFoto).toHaveBeenCalledWith('MHO127'));
    expect(api.deleteFoto).toHaveBeenCalledTimes(1);
  });

  it('löscht kein Foto, wenn im Zeilen-Formular nichts hochgeladen wurde', async () => {
    await ladeVorlageUndOeffneZeile();

    klickeLetztenAbbrechen();

    expect(api.deleteFoto).not.toHaveBeenCalled();
  });

  it('löscht das Foto nicht, wenn die Zeile übernommen und gespeichert wird', async () => {
    await ladeFotoInZeilenFormular();
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    await speichereMehrfach();

    expect(api.deleteFoto).not.toHaveBeenCalled();
  });

  it('löscht übernommene Fotos, wenn das Mehrfach-Modal abgebrochen wird', async () => {
    await ladeFotoInZeilenFormular();
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => expect(api.deleteFoto).toHaveBeenCalledWith('MHO127'));
    expect(screen.queryByRole('heading', { name: 'Schmuckstücke aus Vorlage anlegen' })).not.toBeInTheDocument();
  });

  it('löscht das Foto einer Zeile, wenn die Zeile entfernt wird', async () => {
    await ladeFotoInZeilenFormular();
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    fireEvent.click(screen.getByTitle('Zeile löschen'));

    await waitFor(() => expect(api.deleteFoto).toHaveBeenCalledWith('MHO127'));
  });
});

describe('Aus Vorlage anlegen: nur über Vorlagen', () => {
  it('startet ohne Zeile und bietet kein "Zeile hinzufügen" an', async () => {
    rendereSeite();
    fireEvent.click(await screen.findByRole('button', { name: '+ Aus Vorlage anlegen' }));

    expect(screen.queryByPlaceholderText('MBH001_2')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zeile hinzufügen/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mehrfach speichern' })).toBeDisabled();
  });
});

describe('Zeile kopieren: weiteres Exemplar derselben Nummer', () => {
  async function ladeVorlage() {
    rendereSeite();
    fireEvent.click(await screen.findByRole('button', { name: '+ Aus Vorlage anlegen' }));
    fireEvent.change(screen.getByPlaceholderText('z.B. MBH001_1'), {
      target: { value: 'MHO123_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Als neue Zeile übernehmen' }));
    await waitFor(() => expect(screen.getAllByPlaceholderText('MBH001_2')[0].value).toBe('MHO127_1'));
  }

  const nummern = () => screen.getAllByPlaceholderText('MBH001_2').map((feld) => feld.value);

  beforeEach(() => {
    api.getSchmuckstueck.mockImplementation(async (nr) => ({
      Artikelnummer: nr,
      Name: 'Tropfen',
      Art: 'Ohrring',
      Verkaufspreis: 24.5,
    }));
    api.getNextArtikelnummer.mockResolvedValue({ prefix: 'MHO', nextNum: 127, artikelnummer: 'MHO127' });
    api.createSchmuckstueckeBulk.mockResolvedValue({ createdCount: 3 });
  });

  it('vergibt der Kopie die gleiche Nummer mit dem nächsten Exemplar', async () => {
    await ladeVorlage();

    fireEvent.click(screen.getByTitle('Zeile kopieren'));

    expect(nummern()).toEqual(['MHO127_1', 'MHO127_2']);
  });

  it('zählt bei weiteren Kopien hoch, auch wenn von der ersten Zeile kopiert wird', async () => {
    await ladeVorlage();

    fireEvent.click(screen.getByTitle('Zeile kopieren'));
    fireEvent.click(screen.getAllByTitle('Zeile kopieren')[0]);

    expect(nummern()).toEqual(['MHO127_1', 'MHO127_3', 'MHO127_2']);
  });

  it('übernimmt die Felder der Quelle und speichert alle Exemplare', async () => {
    await ladeVorlage();
    fireEvent.click(screen.getByTitle('Zeile kopieren'));
    fireEvent.click(screen.getAllByTitle('Zeile kopieren')[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Mehrfach speichern' }));

    await waitFor(() => expect(api.createSchmuckstueckeBulk).toHaveBeenCalledTimes(1));
    const items = api.createSchmuckstueckeBulk.mock.calls[0][0].items;
    expect(items.map((item) => item.Artikelnummer)).toEqual(['MHO127_1', 'MHO127_3', 'MHO127_2']);
    expect(items.every((item) => item.Name === 'Tropfen')).toBe(true);
  });

  it('behält das Foto, solange noch ein Exemplar der Nummer in der Tabelle steht', async () => {
    await ladeVorlage();
    const knoepfe = screen.getAllByTitle('Alle Felder bearbeiten');
    fireEvent.click(knoepfe[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Foto für MHO127_1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    fireEvent.click(screen.getByTitle('Zeile kopieren'));

    fireEvent.click(screen.getAllByTitle('Zeile löschen')[1]);
    await waitFor(() => expect(nummern()).toEqual(['MHO127_1']));
    expect(api.deleteFoto).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Zeile löschen'));
    await waitFor(() => expect(api.deleteFoto).toHaveBeenCalledWith('MHO127'));
  });
});

describe('Status-Chips statt Status-Dropdown', () => {
  const letzteListenParams = () => api.getSchmuckstuecke.mock.calls.at(-1)[0];
  const klickeChip = (name) => fireEvent.click(screen.getByRole('button', { name }));

  beforeEach(() => {
    api.getKunden.mockResolvedValue([
      { ID: 3, Name: 'Laden A' },
      { ID: 7, Name: 'Laden B' },
    ]);
    api.getStatusZahlen.mockResolvedValue({ alle: 10, lager: 4, ausgelagert: 3, verkauft: 2, ausschuss: 1 });
  });

  it('zeigt die Chips mit den Zahlen aus getStatusZahlen', async () => {
    rendereSeite();

    expect(await screen.findByRole('button', { name: /^Im Lager\s*4$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Alle\s*10$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Ausgelagert\s*3$/ })).toBeInTheDocument();
  });

  it('hat kein Status-Dropdown mehr, der Standort-Filter bleibt', async () => {
    rendereSeite();

    await screen.findByRole('button', { name: /^Alle\s*10$/ });
    expect(screen.queryByRole('option', { name: 'Nicht verkauft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alle Standorte' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Laden A' })).toBeInTheDocument();
  });

  it('Chip "Verkauft" lädt die Liste mit verkauft=1; erneuter Klick setzt zurück', async () => {
    rendereSeite();
    await screen.findByRole('button', { name: /^Alle\s*10$/ });

    klickeChip(/^Verkauft/);
    await waitFor(() => expect(letzteListenParams()).toMatchObject({ verkauft: '1', page: 1 }));
    expect(screen.getByRole('button', { name: /^Verkauft/ })).toHaveAttribute('aria-pressed', 'true');

    klickeChip(/^Verkauft/);
    await waitFor(() => expect(letzteListenParams()).not.toHaveProperty('verkauft'));
    expect(screen.getByRole('button', { name: /^Alle/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Chip "Im Lager" lädt Lager, nicht verkauft, kein Ausschuss', async () => {
    rendereSeite();
    await screen.findByRole('button', { name: /^Alle\s*10$/ });

    klickeChip(/^Im Lager/);

    await waitFor(() =>
      expect(letzteListenParams()).toMatchObject({ ausgelagert: '0', verkauft: '0', ausschuss: '0' }),
    );
  });

  it('Chip "Ausgelagert" schickt ausgelagert=kunden; der Kunden-Filter engt ihn ein', async () => {
    rendereSeite();
    await screen.findByRole('option', { name: 'Laden A' });

    klickeChip(/^Ausgelagert/);
    await waitFor(() =>
      expect(letzteListenParams()).toMatchObject({ ausgelagert: 'kunden', verkauft: '0', ausschuss: '0' }),
    );

    fireEvent.change(screen.getByDisplayValue('Alle Standorte'), { target: { value: '7' } });
    await waitFor(() =>
      expect(letzteListenParams()).toMatchObject({ ausgelagert: '7', verkauft: '0', ausschuss: '0' }),
    );
  });

  it('Kundenwahl setzt den Chip "Ausgelagert"', async () => {
    rendereSeite();
    await screen.findByRole('option', { name: 'Laden A' });

    fireEvent.change(screen.getByDisplayValue('Alle Standorte'), { target: { value: '7' } });

    await waitFor(() =>
      expect(letzteListenParams()).toMatchObject({ ausgelagert: '7', verkauft: '0', ausschuss: '0' }),
    );
    expect(screen.getByRole('button', { name: /^Ausgelagert/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Standort "Lager" setzt den Chip "Im Lager"', async () => {
    rendereSeite();
    await screen.findByRole('option', { name: 'Laden A' });

    fireEvent.change(screen.getByDisplayValue('Alle Standorte'), { target: { value: '0' } });

    await waitFor(() =>
      expect(letzteListenParams()).toMatchObject({ ausgelagert: '0', verkauft: '0', ausschuss: '0' }),
    );
    expect(screen.getByRole('button', { name: /^Im Lager/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ein anderer Chip setzt den Kunden-Filter zurück', async () => {
    rendereSeite();
    await screen.findByRole('option', { name: 'Laden A' });
    fireEvent.change(screen.getByDisplayValue('Alle Standorte'), { target: { value: '7' } });
    await waitFor(() => expect(letzteListenParams()).toMatchObject({ ausgelagert: '7' }));

    klickeChip(/^Verkauft/);

    await waitFor(() => expect(letzteListenParams()).toMatchObject({ verkauft: '1' }));
    expect(letzteListenParams()).not.toHaveProperty('ausgelagert');
    expect(screen.getByDisplayValue('Alle Standorte')).toBeInTheDocument();
  });

  it('Klick auf den aktiven Chip "Ausgelagert" setzt auch den Kunden zurück', async () => {
    rendereSeite();
    await screen.findByRole('option', { name: 'Laden A' });
    fireEvent.change(screen.getByDisplayValue('Alle Standorte'), { target: { value: '7' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Ausgelagert/ })).toHaveAttribute('aria-pressed', 'true'));

    klickeChip(/^Ausgelagert/);

    await waitFor(() => expect(letzteListenParams()).not.toHaveProperty('ausgelagert'));
    expect(screen.getByRole('button', { name: /^Alle/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('holt die Zahlen mit Suche und Kunden-Filter, aber ohne Statusparameter', async () => {
    rendereSeite();
    await screen.findByRole('option', { name: 'Laden A' });
    klickeChip(/^Verkauft/);
    fireEvent.change(screen.getByDisplayValue('Alle Standorte'), { target: { value: '3' } });

    await waitFor(() => expect(api.getStatusZahlen).toHaveBeenLastCalledWith({ ausgelagert: '3' }));
    expect(api.getStatusZahlen.mock.calls.every(([p]) => !('verkauft' in p) && !('ausschuss' in p))).toBe(true);
  });

  it('entprellt die Suche: ein Zahlen-Request statt einer je Tastendruck', async () => {
    rendereSeite();
    await screen.findByRole('button', { name: /^Alle\s*10$/ });
    const vorher = api.getStatusZahlen.mock.calls.length;

    const suche = screen.getByPlaceholderText(/Suche nach Artikelnummer/);
    for (const wert of ['M', 'MH', 'MHO']) fireEvent.change(suche, { target: { value: wert } });

    await waitFor(() => expect(api.getStatusZahlen).toHaveBeenLastCalledWith({ search: 'MHO' }));
    expect(api.getStatusZahlen.mock.calls.length).toBe(vorher + 1);
  });

  it('aktualisiert die Zahlen nach einer Statusänderung (Stück angelegt)', async () => {
    api.getSchmuckstueck.mockResolvedValue({ Artikelnummer: 'MHO123_1', Name: 'Tropfen' });
    api.getNextArtikelnummer.mockResolvedValue({ artikelnummer: 'MHO127' });
    api.createSchmuckstueckeBulk.mockResolvedValue({ createdCount: 1 });
    rendereSeite();
    await screen.findByRole('button', { name: /^Alle\s*10$/ });

    fireEvent.click(screen.getByRole('button', { name: '+ Aus Vorlage anlegen' }));
    fireEvent.change(screen.getByPlaceholderText('z.B. MBH001_1'), { target: { value: 'MHO123_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Als neue Zeile übernehmen' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Als neue Zeile übernehmen' })).toBeEnabled(),
    );
    api.getStatusZahlen.mockResolvedValue({ alle: 11, lager: 5, ausgelagert: 3, verkauft: 2, ausschuss: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Mehrfach speichern' }));

    expect(await screen.findByRole('button', { name: /^Alle\s*11$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Im Lager\s*5$/ })).toBeInTheDocument();
  });

  it('Chip-Zahl und Listen-Treffer sind für jeden Chip gleich (Verhalten des Backends nachgebildet)', async () => {
    // Bildet statusFilterAnwenden/ausgelagertFilterAnwenden und die Zählung nach.
    const stuecke = [
      { Ausgelagert: 0, Verkauft: false, Ausschuss: false },
      { Ausgelagert: 0, Verkauft: false, Ausschuss: false },
      { Ausgelagert: 3, Verkauft: false, Ausschuss: false },
      { Ausgelagert: 7, Verkauft: false, Ausschuss: false },
      { Ausgelagert: 7, Verkauft: false, Ausschuss: false },
      { Ausgelagert: 0, Verkauft: true, Ausschuss: false },
      { Ausgelagert: 3, Verkauft: true, Ausschuss: false },
      { Ausgelagert: 0, Verkauft: false, Ausschuss: true },
      { Ausgelagert: 3, Verkauft: true, Ausschuss: true },
    ];
    const flag = (w) => w === '1';
    const liste = (p) =>
      stuecke.filter((s) => {
        if (p.verkauft !== undefined && (flag(p.verkauft) ? !(s.Verkauft && !s.Ausschuss) : s.Verkauft)) return false;
        if (p.ausschuss !== undefined && flag(p.ausschuss) !== s.Ausschuss) return false;
        if (p.ausgelagert === 'kunden' ? s.Ausgelagert === 0 : p.ausgelagert !== undefined && !p.ausgelagert.split(',').map(Number).includes(s.Ausgelagert)) return false;
        return true;
      });
    api.getSchmuckstuecke.mockImplementation(async (p) => ({ data: [], pagination: { total: liste(p).length } }));
    api.getStatusZahlen.mockResolvedValue({
      alle: stuecke.length,
      lager: stuecke.filter((s) => s.Ausgelagert === 0 && !s.Verkauft && !s.Ausschuss).length,
      ausgelagert: stuecke.filter((s) => s.Ausgelagert > 0 && !s.Verkauft && !s.Ausschuss).length,
      verkauft: stuecke.filter((s) => s.Verkauft && !s.Ausschuss).length,
      ausschuss: stuecke.filter((s) => s.Ausschuss).length,
    });
    rendereSeite();
    await screen.findByRole('option', { name: 'Laden A' });

    for (const [name, erwartet] of [
      [/^Alle/, 9],
      [/^Im Lager/, 2],
      [/^Ausgelagert/, 3],
      [/^Verkauft/, 2],
      [/^Ausschuss/, 2],
    ]) {
      klickeChip(name);
      expect(await screen.findByText(`${erwartet} Stücke insgesamt`)).toBeInTheDocument();
      const chip = screen.getByRole('button', { name });
      expect(chip).toHaveTextContent(new RegExp(`${erwartet}$`));
      if (name.source !== '^Alle') klickeChip(name);
    }
  });
});

describe('Ansicht: Tabelle oder Foto-Raster', () => {
  const stueck = (nr, extra = {}) => ({
    Artikelnummer: nr, Name: 'Seerose', Art: 'Ohrring', Verkaufspreis: 24.5,
    Ausgelagert: 0, Verkauft: false, Ausschuss: false, hatFoto: false, ...extra,
  });
  const SCHLUESSEL = 'schmuckstuecke-ansicht';
  const tabelleBtn = () => screen.getByRole('button', { name: 'Tabellenansicht' });
  const rasterBtn = () => screen.getByRole('button', { name: 'Rasteransicht' });

  beforeEach(() => {
    localStorage.clear();
    api.getSchmuckstuecke.mockResolvedValue({
      data: [stueck('MHO1_1'), stueck('MHO2_1', { Name: 'Welle' })],
      pagination: { total: 2, totalPages: 1 },
    });
    api.getSchmuckstueck.mockResolvedValue(stueck('MHO2_1', { Name: 'Welle' }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('startet mit der Tabelle', async () => {
    rendereSeite();

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(tabelleBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(rasterBtn()).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('.foto-raster')).toBeNull();
  });

  it('wechselt zwischen Tabelle und Raster', async () => {
    rendereSeite();
    await screen.findByRole('table');

    fireEvent.click(rasterBtn());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.foto-kachel')).toHaveLength(2);
    expect(rasterBtn()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(tabelleBtn());
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(document.querySelector('.foto-raster')).toBeNull();
  });

  it('Klick auf eine Kachel öffnet das Detail des Stücks', async () => {
    rendereSeite();
    await screen.findByRole('table');
    fireEvent.click(rasterBtn());

    fireEvent.click(screen.getByText('Welle').closest('button'));

    await waitFor(() => expect(api.getSchmuckstueck).toHaveBeenCalledWith('MHO2_1'));
  });

  it('merkt sich die Ansicht über ein Neuladen', async () => {
    const erste = rendereSeite();
    await screen.findByRole('table');
    fireEvent.click(rasterBtn());
    expect(localStorage.getItem(SCHLUESSEL)).toBe('raster');
    erste.unmount();

    rendereSeite();
    await waitFor(() => expect(document.querySelectorAll('.foto-kachel')).toHaveLength(2));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('funktioniert, wenn localStorage wirft', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('gesperrt'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('gesperrt'); });
    rendereSeite();

    expect(await screen.findByRole('table')).toBeInTheDocument();
    fireEvent.click(rasterBtn());
    expect(document.querySelectorAll('.foto-kachel')).toHaveLength(2);
  });

  it('ignoriert einen ungültigen gespeicherten Wert', async () => {
    localStorage.setItem(SCHLUESSEL, 'quatsch');
    rendereSeite();
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('das Raster nutzt dieselben Daten und Filter wie die Tabelle', async () => {
    api.getStatusZahlen.mockResolvedValue({ alle: 2, lager: 1, ausgelagert: 0, verkauft: 1, ausschuss: 0 });
    rendereSeite();
    await screen.findByRole('table');
    fireEvent.click(rasterBtn());

    fireEvent.click(await screen.findByRole('button', { name: /^Verkauft/ }));
    await waitFor(() => expect(api.getSchmuckstuecke.mock.calls.at(-1)[0]).toMatchObject({ verkauft: '1', page: 1 }));
  });
});

describe('Detail-Panel statt Fenster', () => {
  const stueck = (nr, extra = {}) => ({
    Artikelnummer: nr, Name: 'Seerose', Art: 'Ohrring', Verkaufspreis: 24.5,
    Ausgelagert: 0, Verkauft: false, Ausschuss: false, hatFoto: false, ...extra,
  });
  const HINWEIS = 'Stück in der Liste auswählen, um Details zu sehen.';
  const liste = [
    stueck('MHO1_1'),
    stueck('MHO2_1', { Name: 'Welle', Art: 'Armband' }),
    stueck('MHO3_1', { Name: 'Düne', Art: 'Kette' }),
  ];
  // Tabellenzeile, deren Text die Art enthält (Name steht nur im Panel); Welle = Armband, Düne = Kette
  const ART = { Welle: 'Armband', Düne: 'Kette', Seerose: 'Ohrring' };
  const zeile = (name) =>
    [...document.querySelectorAll('.data-table tbody tr')].find((z) => z.textContent.includes(ART[name] ?? name));
  const kachel = (name) => [...document.querySelectorAll('.foto-kachel')].find((k) => k.textContent.includes(name));
  const listeBereit = () => waitFor(() => expect(zeile('Welle')).toBeTruthy());
  const reihenfolge = () => [...document.querySelectorAll('.data-table tbody tr')].map((z) => z.querySelector('strong').textContent);
  const panel = () => document.querySelector('.schmuck-panel');
  const taste = (key, ziel = document.body) => fireEvent.keyDown(ziel, { key });
  const markiert = () => [...document.querySelectorAll('.data-table-row-aktiv')];

  beforeEach(() => {
    localStorage.clear();
    api.getSchmuckstuecke.mockResolvedValue({ data: liste, pagination: { total: 3, totalPages: 1 } });
    api.getSchmuckstueck.mockImplementation(async (nr) => liste.find((s) => s.Artikelnummer === nr));
  });
  afterEach(() => {
    delete window.matchMedia;
  });

  describe('breites Fenster (ab 1024 px)', () => {
    beforeEach(() => mockeBreite(1280));

    it('zeigt ohne Auswahl den Hinweis im Panel und die breite Tabelle statt der Kompakt-Liste', async () => {
      rendereSeite();

      await listeBereit();
      expect(panel()).toHaveTextContent(HINWEIS);
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Grundmaterial/ })).toBeInTheDocument();
      expect(document.querySelector('.schmuckstueck-zeile')).toBeNull();
      expect(document.querySelector('.modal-overlay')).toBeNull();
    });

    it('nur Suche, Filter und Status-Chips sind fixiert; Titel und Reiter scrollen mit', async () => {
      rendereSeite();
      await listeBereit();

      const kopf = document.querySelector('.schmuck-kopf');
      expect(kopf).toHaveClass('schmuck-kopf--fixiert');
      expect(kopf).toContainElement(screen.getByPlaceholderText(/Suche nach Artikelnummer/));
      expect(kopf).toContainElement(screen.getByRole('button', { name: /^Alle/ }));
      expect(kopf).not.toContainElement(screen.getByRole('heading', { name: 'Schmuckstücke' }));
      expect(kopf).not.toContainElement(screen.getByRole('button', { name: 'Etiketten' }));
      expect(kopf).not.toContainElement(screen.getByRole('table'));
    });

    it('die Aufteilung Liste/Panel bleibt in .schmuck-split', async () => {
      rendereSeite();
      await listeBereit();

      const split = document.querySelector('.schmuck-split');
      expect(split).toContainElement(screen.getByRole('table'));
      expect(split).toContainElement(panel());
    });

    it('Klick auf eine Zeile füllt das Panel, die Liste bleibt sichtbar und die Zeile ist hervorgehoben', async () => {
      rendereSeite();
      await listeBereit();

      fireEvent.click(zeile('Welle'));

      expect(await within(panel()).findByRole('heading', { name: /MHO2_1/ })).toBeInTheDocument();
      expect(panel()).not.toHaveTextContent(HINWEIS);
      expect(document.querySelector('.modal-overlay')).toBeNull();
      expect(zeile('Düne')).toBeTruthy();
      expect(zeile('Welle')).toHaveClass('data-table-row-aktiv');
      expect(zeile('Welle')).toHaveAttribute('aria-current', 'true');
      expect(zeile('Düne')).not.toHaveClass('data-table-row-aktiv');
      expect(zeile('Düne')).not.toHaveAttribute('aria-current');
      expect(markiert()).toHaveLength(1);
    });

    it('Pfeil runter folgt der sichtbaren Reihenfolge nach Klick auf einen Spaltenkopf', async () => {
      rendereSeite();
      await listeBereit();
      expect(reihenfolge()).toEqual(['MHO1', 'MHO2', 'MHO3']);

      // Art aufsteigend: Armband (MHO2), Kette (MHO3), Ohrring (MHO1)
      fireEvent.click(screen.getByRole('columnheader', { name: /^Art\s/ }));
      expect(reihenfolge()).toEqual(['MHO2', 'MHO3', 'MHO1']);

      taste('ArrowDown');
      expect(await within(panel()).findByRole('heading', { name: /MHO2_1/ })).toBeInTheDocument();
      taste('ArrowDown');
      expect(await within(panel()).findByRole('heading', { name: /MHO3_1/ })).toBeInTheDocument();
      taste('ArrowDown');
      expect(await within(panel()).findByRole('heading', { name: /MHO1_1/ })).toBeInTheDocument();
      taste('ArrowUp');
      expect(await within(panel()).findByRole('heading', { name: /MHO3_1/ })).toBeInTheDocument();
    });

    it('pausiert die Fotos der Liste nicht, solange nur das Panel offen ist', async () => {
      rendereSeite();
      await listeBereit();

      fireEvent.click(zeile('Welle'));
      await within(panel()).findByRole('heading', { name: /MHO2_1/ });

      screen.getAllByTestId('tablephoto').forEach((f) => expect(f).toHaveAttribute('data-pause', 'false'));
    });

    it('Esc hebt die Auswahl auf', async () => {
      rendereSeite();
      await listeBereit();
      fireEvent.click(zeile('Welle'));
      await within(panel()).findByRole('heading', { name: /MHO2_1/ });

      taste('Escape');

      expect(panel()).toHaveTextContent(HINWEIS);
      expect(markiert()).toHaveLength(0);
    });

    it('Pfeil runter wählt zuerst das erste Stück, dann das nächste; Pfeil hoch geht zurück', async () => {
      rendereSeite();
      await listeBereit();

      taste('ArrowDown');
      expect(await within(panel()).findByRole('heading', { name: /MHO1_1/ })).toBeInTheDocument();
      taste('ArrowDown');
      expect(await within(panel()).findByRole('heading', { name: /MHO2_1/ })).toBeInTheDocument();
      taste('ArrowUp');
      expect(await within(panel()).findByRole('heading', { name: /MHO1_1/ })).toBeInTheDocument();
      expect(markiert()).toHaveLength(1);
    });

    it('bleibt an den Enden der Liste stehen', async () => {
      rendereSeite();
      await listeBereit();
      fireEvent.click(zeile('Düne'));
      await within(panel()).findByRole('heading', { name: /MHO3_1/ });

      taste('ArrowDown');
      expect(await within(panel()).findByRole('heading', { name: /MHO3_1/ })).toBeInTheDocument();
    });

    it('Pfeil hoch ohne Auswahl wählt das letzte Stück', async () => {
      rendereSeite();
      await listeBereit();

      taste('ArrowUp');

      expect(await within(panel()).findByRole('heading', { name: /MHO3_1/ })).toBeInTheDocument();
    });

    it('Pfeiltasten und Esc wirken nicht im Suchfeld', async () => {
      rendereSeite();
      await listeBereit();
      fireEvent.click(zeile('Welle'));
      await within(panel()).findByRole('heading', { name: /MHO2_1/ });
      const suche = screen.getByPlaceholderText(/Suche nach Artikelnummer/);

      taste('ArrowDown', suche);
      taste('Escape', suche);

      expect(within(panel()).getByRole('heading', { name: /MHO2_1/ })).toBeInTheDocument();
      expect(zeile('Welle')).toHaveClass('data-table-row-aktiv');
    });

    it('Pfeiltasten wirken nicht in einem Auswahlfeld', async () => {
      rendereSeite();
      await listeBereit();
      const auswahl = screen.getByDisplayValue('Alle Arten');

      taste('ArrowDown', auswahl);

      expect(panel()).toHaveTextContent(HINWEIS);
    });

    it('Esc schließt die Auswahl nicht, solange ein Modal offen ist', async () => {
      rendereSeite();
      await listeBereit();
      fireEvent.click(zeile('Welle'));
      await within(panel()).findByRole('heading', { name: /MHO2_1/ });
      fireEvent.click(screen.getByRole('button', { name: '+ Aus Vorlage anlegen' }));
      await screen.findByRole('heading', { name: 'Schmuckstücke aus Vorlage anlegen' });

      taste('Escape');
      taste('ArrowDown');

      expect(within(panel()).getByRole('heading', { name: /MHO2_1/ })).toBeInTheDocument();
    });

    it('hebt die Auswahl auf, wenn das Stück durch die Suche aus der Liste verschwindet', async () => {
      rendereSeite();
      await listeBereit();
      fireEvent.click(zeile('Welle'));
      await within(panel()).findByRole('heading', { name: /MHO2_1/ });
      api.getSchmuckstuecke.mockResolvedValue({ data: [liste[0]], pagination: { total: 1, totalPages: 1 } });

      fireEvent.change(screen.getByPlaceholderText(/Suche nach Artikelnummer/), { target: { value: 'MHO1' } });

      await waitFor(() => expect(panel()).toHaveTextContent(HINWEIS));
      expect(markiert()).toHaveLength(0);
    });

    it('behält die Auswahl, wenn das Stück nach einem Filterwechsel weiter in der Liste steht', async () => {
      rendereSeite();
      await listeBereit();
      fireEvent.click(zeile('Welle'));
      await within(panel()).findByRole('heading', { name: /MHO2_1/ });

      fireEvent.change(screen.getByPlaceholderText(/Suche nach Artikelnummer/), { target: { value: 'MHO' } });
      await waitFor(() => expect(api.getSchmuckstuecke.mock.calls.at(-1)[0]).toMatchObject({ search: 'MHO' }));
      await listeBereit();

      expect(within(panel()).getByRole('heading', { name: /MHO2_1/ })).toBeInTheDocument();
    });

    it('Panel funktioniert auch in der Raster-Ansicht', async () => {
      rendereSeite();
      await listeBereit();
      fireEvent.click(screen.getByRole('button', { name: 'Rasteransicht' }));

      expect(document.querySelectorAll('.foto-kachel')).toHaveLength(3);
      fireEvent.click(kachel('Welle'));

      expect(await within(panel()).findByRole('heading', { name: /MHO2_1/ })).toBeInTheDocument();
      expect(document.querySelectorAll('.foto-kachel')).toHaveLength(3);
      expect(document.querySelector('.modal-overlay')).toBeNull();
      expect(document.querySelector('.foto-kachel--aktiv')).toHaveTextContent('Welle');
      taste('Escape');
      expect(panel()).toHaveTextContent(HINWEIS);
      expect(document.querySelector('.foto-kachel--aktiv')).toBeNull();
    });

    it('Bearbeiten im Panel öffnet das Formular mit demselben Handler wie im Fenster', async () => {
      rendereSeite('admin');
      await listeBereit();
      fireEvent.click(zeile('Welle'));

      fireEvent.click(await within(panel()).findByRole('button', { name: /Bearbeiten/ }));

      expect(await screen.findByRole('heading', { name: /bearbeiten/i })).toBeInTheDocument();
      expect(panel()).toHaveTextContent(HINWEIS);
      screen.getAllByTestId('tablephoto').forEach((f) => expect(f).toHaveAttribute('data-pause', 'true'));
    });

    it('ohne Rolle Bearbeiter zeigt das Panel keine Aktionen', async () => {
      rendereSeite('user');
      await listeBereit();
      fireEvent.click(zeile('Welle'));
      await within(panel()).findByRole('heading', { name: /MHO2_1/ });

      expect(within(panel()).queryByRole('button', { name: /Bearbeiten/ })).not.toBeInTheDocument();
    });
  });

  describe('schmales Fenster (unter 1024 px)', () => {
    it('öffnet das Stück als Fenster und zeigt kein Panel', async () => {
      mockeBreite(900);
      rendereSeite();
      await screen.findByRole('table');

      fireEvent.click(screen.getByText('Armband'));

      await waitFor(() => expect(document.querySelector('.schmuck-modal')).not.toBeNull());
      expect(panel()).toBeNull();
      expect(await screen.findByRole('heading', { name: /MHO2_1/ })).toBeInTheDocument();
    });

    it('Pfeiltasten und Esc ändern nichts, der Kopf ist nicht fixiert', async () => {
      mockeBreite(900);
      rendereSeite();
      await screen.findByRole('table');
      expect(document.querySelector('.schmuck-kopf')).not.toHaveClass('schmuck-kopf--fixiert');
      expect(document.querySelector('.schmuck-split')).toBeNull();

      taste('ArrowDown');

      expect(document.querySelector('.schmuck-modal')).toBeNull();
    });

    it('wechselt beim Verbreitern des Fensters vom Fenster ins Panel', async () => {
      const fenster = mockeBreite(900);
      rendereSeite();
      await screen.findByRole('table');
      fireEvent.click(screen.getByText('Armband'));
      await waitFor(() => expect(document.querySelector('.schmuck-modal')).not.toBeNull());

      act(() => fenster.setze(1280));

      await waitFor(() => expect(document.querySelector('.schmuck-modal')).toBeNull());
      expect(await within(panel()).findByRole('heading', { name: /MHO2_1/ })).toBeInTheDocument();
    });
  });

  it('ohne matchMedia (jsdom) bleibt es beim Fenster', async () => {
    rendereSeite();
    await screen.findByRole('table');

    fireEvent.click(screen.getByText('Armband'));

    await waitFor(() => expect(document.querySelector('.schmuck-modal')).not.toBeNull());
    expect(panel()).toBeNull();
  });
});
