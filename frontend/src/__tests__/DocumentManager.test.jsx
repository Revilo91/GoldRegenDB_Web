import { screen, fireEvent, waitFor } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import React from 'react';
import DocumentManager from '../pages/DocumentManager';

const icons = { header: 'header', modal: 'modal', user: 'user', trash: 'trash', times: 'times' };

const labels = {
  header: 'Lieferscheine',
  newBtn: '+ Neuer Lieferschein',
  modalTitle: 'Neuer Lieferschein',
  excel: 'Lieferschein erstellen',
  delete: 'Löschen',
  deleteConfirm: 'Lieferschein wirklich löschen?',
  excelFilePrefix: 'Lieferschein',
  kundeRequired: 'Bitte Kunde angeben.',
  pieceNotFound: (nr) => `Artikelnummer "${nr}" nicht gefunden oder nicht verfügbar.`,
};

function buildApi(overrides = {}) {
  return {
    getList: vi.fn().mockResolvedValue([
      { ID: 1, Nummer: '2026-001', Kundennummer: 1, KundenName: 'Anna', status: 'final', Datum: '2026-01-01' },
      { ID: 2, Nummer: '2026-002', Kundennummer: 2, KundenName: 'Bernd', status: 'entwurf', Datum: '2026-02-01' },
    ]),
    getKunden: vi.fn().mockResolvedValue([
      { ID: 1, Name: 'Anna', Aktiv: true },
      { ID: 2, Name: 'Bernd', Aktiv: true },
    ]),
    getDetail: vi.fn().mockResolvedValue({ ID: 1, Nummer: '2026-001', KundenName: 'Anna', status: 'final', Datum: '2026-01-01', schmuckstuecke: [] }),
    deleteItem: vi.fn().mockResolvedValue({}),
    createItem: vi.fn().mockResolvedValue({}),
    updateItem: vi.fn().mockResolvedValue({}),
    exportExcel: vi.fn().mockResolvedValue(new Blob()),
    getPieces: vi.fn().mockResolvedValue({ data: [] }),
    getNextNumber: vi.fn().mockResolvedValue({ Nummer: '2026-003' }),
    ...overrides,
  };
}

function renderManager(apiOverrides = {}) {
  const api = buildApi(apiOverrides);
  rendereMitToast(
    <DocumentManager
      type="lieferschein"
      api={api}
      icons={icons}
      labels={labels}
      pieceFilter={() => ({})}
      pieceSelectMode="all"
    />,
  );
  return api;
}

describe('DocumentManager', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('lädt und zeigt die Dokumentliste an', async () => {
    renderManager();

    expect(await screen.findByText('2026-001')).toBeInTheDocument();
    expect(screen.getByText('2026-002')).toBeInTheDocument();
    expect(screen.getAllByText('Anna').length).toBeGreaterThan(0);
  });

  it('filtert die Liste über die Suche', async () => {
    renderManager();
    await screen.findByText('2026-001');

    fireEvent.change(screen.getByPlaceholderText('Suche nach Nummer, Kunde, ID...'), {
      target: { value: 'Bernd' },
    });

    expect(screen.queryByText('2026-001')).not.toBeInTheDocument();
    expect(screen.getByText('2026-002')).toBeInTheDocument();
  });

  it('öffnet das Detail-Modal beim Klick auf eine Zeile', async () => {
    const api = renderManager();
    await screen.findByText('2026-001');

    fireEvent.click(screen.getByText('2026-001'));

    await waitFor(() => expect(api.getDetail).toHaveBeenCalledWith(1));
    expect(await screen.findByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('verhindert das Speichern ohne ausgewählten Kunden', async () => {
    const api = renderManager();
    await screen.findByText('2026-001');

    fireEvent.click(screen.getByText('+ Neuer Lieferschein'));
    await screen.findByText('Neuer Lieferschein');

    fireEvent.click(screen.getByText('Speichern & Abschließen'));

    // Frueher ein blockierendes alert(), jetzt ein Toast im Dokument (Befund G19).
    expect(await screen.findByText(labels.kundeRequired)).toBeInTheDocument();
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it('speichert ein neues Dokument mit ausgewähltem Kunden', async () => {
    const api = renderManager();
    await screen.findByText('2026-001');

    fireEvent.click(screen.getByText('+ Neuer Lieferschein'));
    await screen.findByText('Neuer Lieferschein');

    fireEvent.change(screen.getByDisplayValue('Bitte wählen...'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Speichern & Abschließen'));

    await waitFor(() => expect(api.createItem).toHaveBeenCalled());
    expect(api.createItem.mock.calls[0][0]).toMatchObject({ Kundennummer: '1', status: 'final' });
  });
});
