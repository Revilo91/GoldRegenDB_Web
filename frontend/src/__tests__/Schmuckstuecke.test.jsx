import { screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { rendereMitToast } from './helpers/rendern';
import Schmuckstuecke from '../pages/Schmuckstuecke';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

vi.mock('../api', () => ({
  api: {
    getFilterOptions: vi.fn(),
    getKunden: vi.fn(),
    getSchmuckstuecke: vi.fn(),
    getSchmuckstueck: vi.fn(),
    getNextArtikelnummer: vi.fn(),
    createSchmuckstueckeBulk: vi.fn(),
    deleteFoto: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../components/TablePhoto', () => ({ default: () => null }));
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
    expect(screen.queryByText('Ausschuss')).not.toBeInTheDocument();
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

describe('Felder je Produktart im Anlegen-Modal', () => {
  const produktarten = [
    { code: 'A', label: 'Armband' },
    { code: 'H', label: 'Halskette' },
    { code: 'O', label: 'Ohrring' },
    { code: 'S', label: 'Schlüsselanhänger' },
  ];

  async function oeffneNeuesStueck() {
    api.getFilterOptions.mockResolvedValue({ grundmaterialien: [], produktarten });
    rendereSeite('bearbeiter');
    fireEvent.click(await screen.findByRole('button', { name: '+ Neues Schmuckstück' }));
    await screen.findByRole('heading', { name: /Neues Schmuckstück/ });
  }

  function waehleProduktart(code) {
    fireEvent.change(screen.getByDisplayValue(/^Produktart$|^[AHOS] - /), {
      target: { value: code },
    });
  }

  const laenge = () => screen.queryByText(/^Länge \(/);
  const anhaenger = () => screen.queryByText('Anhänger Fassung');
  const zwischenstueck = () => screen.queryByText('Zwischenstück', { selector: 'label' });

  it('zeigt vor der Wahl der Produktart alle Felder', async () => {
    await oeffneNeuesStueck();

    expect(laenge()).toBeInTheDocument();
    expect(anhaenger()).toBeInTheDocument();
    expect(zwischenstueck()).toBeInTheDocument();
  });

  it.each([
    ['A', true, false, true],
    ['H', true, true, true],
    ['O', true, false, false],
    ['S', false, true, false],
  ])('Produktart %s: Länge %s, Anhänger %s, Zwischenstück %s', async (code, hatLaenge, hatAnhaenger, hatZwischen) => {
    await oeffneNeuesStueck();

    waehleProduktart(code);

    expect(!!laenge()).toBe(hatLaenge);
    expect(!!anhaenger()).toBe(hatAnhaenger);
    expect(!!zwischenstueck()).toBe(hatZwischen);
    expect(screen.queryByRole('heading', { name: /Anhänger|Zwischenstück/ }) !== null).toBe(hatAnhaenger || hatZwischen);
  });

  it('behält den Wert eines ausgeblendeten Feldes', async () => {
    await oeffneNeuesStueck();
    waehleProduktart('H');
    fireEvent.change(screen.getByText('Anhänger Fassung').parentElement.querySelector('input'), {
      target: { value: 'Silber' },
    });

    waehleProduktart('O');
    expect(anhaenger()).not.toBeInTheDocument();
    waehleProduktart('H');

    expect(screen.getByDisplayValue('Silber')).toBeInTheDocument();
  });
});
