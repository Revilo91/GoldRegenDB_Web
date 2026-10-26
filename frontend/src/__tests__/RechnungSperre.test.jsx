import { screen, fireEvent, waitFor } from '@testing-library/react';
import { rendereMitToast } from './helpers/rendern';
import React from 'react';
import DocumentManager from '../pages/DocumentManager';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

const icons = { header: 'header', modal: 'modal', user: 'user', trash: 'trash', times: 'times' };
const labels = {
  header: 'Rechnungen',
  newBtn: '+ Neue Rechnung',
  modalTitle: 'Neue Rechnung',
  excel: 'Rechnung erstellen',
  delete: 'Löschen',
  deleteConfirm: 'Rechnung wirklich löschen?',
  excelFilePrefix: 'Rechnung',
  kundeRequired: 'Bitte Kunde angeben.',
  pieceNotFound: (nr) => `Artikelnummer "${nr}" nicht gefunden.`,
};

const BEGRUENDUNG = 'Falscher Kunde ausgewählt';

function renderManager(status, rolle, { type = 'rechnung', apiOverrides = {} } = {}) {
  useAuth.mockReturnValue({ user: { username: 'tester', role: rolle } });
  const api = {
    getList: vi.fn().mockResolvedValue([
      { ID: 1, Nummer: '2026-001', KundenName: 'Anna', Kundennummer: 1, status, Datum: '2026-01-01' },
    ]),
    getKunden: vi.fn().mockResolvedValue([{ ID: 1, Name: 'Anna', Aktiv: true }]),
    getDetail: vi.fn().mockResolvedValue({
      ID: 1, Nummer: '2026-001', KundenName: 'Anna', status, Datum: '2026-01-01', schmuckstuecke: [],
    }),
    deleteItem: vi.fn().mockResolvedValue({}),
    createItem: vi.fn().mockResolvedValue({}),
    updateItem: vi.fn().mockResolvedValue({}),
    resetItem: vi.fn().mockResolvedValue({}),
    exportExcel: vi.fn().mockResolvedValue(new Blob()),
    getPieces: vi.fn().mockResolvedValue({ data: [] }),
    getNextNumber: vi.fn().mockResolvedValue({ Nummer: '2026-003' }),
    ...apiOverrides,
  };
  rendereMitToast(
    <DocumentManager type={type} api={api} icons={icons} labels={labels} pieceFilter={() => ({})} />,
  );
  return api;
}

async function oeffneDetail() {
  fireEvent.click(await screen.findByText('2026-001'));
  await screen.findByText(/Kunde$/);
}

describe('Finale Rechnung ist gesperrt (#283)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('blendet bei finaler Rechnung Löschen und Bearbeiten aus', async () => {
    renderManager('final', 'bearbeiter');
    await oeffneDetail();

    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('zeigt Zurücksetzen nur Admins', async () => {
    renderManager('final', 'bearbeiter');
    await oeffneDetail();

    expect(screen.queryByRole('button', { name: 'Zurücksetzen' })).not.toBeInTheDocument();
  });

  it('lässt Entwürfe bearbeitbar, abschließbar und löschbar', async () => {
    renderManager('entwurf', 'admin');
    await oeffneDetail();

    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zurücksetzen' })).not.toBeInTheDocument();
  });

  it('lässt den Lieferschein unverändert löschbar, auch wenn er final ist', async () => {
    renderManager('final', 'admin', { type: 'lieferschein' });
    await oeffneDetail();

    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zurücksetzen' })).not.toBeInTheDocument();
  });

  describe('Admin-Reset', () => {
    async function oeffneResetDialog(apiOverrides) {
      const api = renderManager('final', 'admin', { apiOverrides });
      await oeffneDetail();
      fireEvent.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
      return { api, feld: await screen.findByLabelText('Begründung') };
    }

    it('sendet die Begründung nach Bestätigung und zeigt eine Erfolgsmeldung', async () => {
      const { api, feld } = await oeffneResetDialog();

      fireEvent.change(feld, { target: { value: `  ${BEGRUENDUNG}  ` } });
      fireEvent.click(screen.getByRole('button', { name: 'Auf Entwurf zurücksetzen' }));

      await waitFor(() => expect(api.resetItem).toHaveBeenCalledWith(1, BEGRUENDUNG));
      expect(window.confirm).toHaveBeenCalled();
      expect(await screen.findByRole('status')).toHaveTextContent('Entwurf');
      // Liste wird neu geladen
      await waitFor(() => expect(api.getList).toHaveBeenCalledTimes(2));
    });

    it('sendet nichts bei zu kurzer Begründung', async () => {
      const { api, feld } = await oeffneResetDialog();

      fireEvent.change(feld, { target: { value: 'kurz' } });
      fireEvent.click(screen.getByRole('button', { name: 'Auf Entwurf zurücksetzen' }));

      expect(api.resetItem).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toHaveTextContent('mindestens 10 Zeichen');
    });

    it('sendet nichts, wenn die Bestätigung abgelehnt wird', async () => {
      window.confirm.mockReturnValue(false);
      const { api, feld } = await oeffneResetDialog();

      fireEvent.change(feld, { target: { value: BEGRUENDUNG } });
      fireEvent.click(screen.getByRole('button', { name: 'Auf Entwurf zurücksetzen' }));

      expect(api.resetItem).not.toHaveBeenCalled();
    });

    it('zeigt Fehler der API (409) als Toast', async () => {
      const { feld } = await oeffneResetDialog({
        resetItem: vi.fn().mockRejectedValue(new Error('Nur finale Rechnungen können zurückgesetzt werden')),
      });

      fireEvent.change(feld, { target: { value: BEGRUENDUNG } });
      fireEvent.click(screen.getByRole('button', { name: 'Auf Entwurf zurücksetzen' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Nur finale Rechnungen können zurückgesetzt werden');
    });
  });
});
