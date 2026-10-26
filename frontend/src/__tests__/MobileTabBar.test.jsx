import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MobileTabBar from '../components/MobileTabBar';
import { baueNavGruppen } from '../utils/navGroups';
import { mockeBreite } from './helpers/matchMedia';

function rendereLeiste(rolle, pfad = '/schmuckstuecke', handler = {}) {
  const user = { username: 'tester', role: rolle };
  return render(
    <MemoryRouter initialEntries={[pfad]}>
      <MobileTabBar
        groups={baueNavGruppen(user)}
        username={user.username}
        onAccount={handler.onAccount ?? (() => {})}
        onLogout={handler.onLogout ?? (() => {})}
      />
    </MemoryRouter>,
  );
}

const tabs = () => within(screen.getByRole('navigation', { name: 'Hauptnavigation mobil' }));

describe('MobileTabBar', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  describe('Sichtbarkeit je Rolle', () => {
    beforeEach(() => mockeBreite(390));

    it('Rolle user sieht nur Stücke und Mehr', () => {
      rendereLeiste('user');
      expect(tabs().getByRole('link', { name: 'Stücke' })).toBeInTheDocument();
      expect(tabs().getByRole('button', { name: 'Mehr' })).toBeInTheDocument();
      expect(tabs().queryByRole('link', { name: 'Inventur' })).not.toBeInTheDocument();
      expect(tabs().queryByRole('link', { name: 'Kunden' })).not.toBeInTheDocument();
      expect(tabs().queryByRole('button', { name: 'Belege' })).not.toBeInTheDocument();
    });

    it('Rolle user: Mehr enthält nur Konto und Abmelden', () => {
      rendereLeiste('user');
      fireEvent.click(tabs().getByRole('button', { name: 'Mehr' }));
      const sheet = screen.getByRole('dialog', { name: 'Mehr' });
      expect(within(sheet).getByRole('button', { name: /Benutzerkonto/ })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: 'Abmelden' })).toBeInTheDocument();
      expect(within(sheet).queryByRole('link')).not.toBeInTheDocument();
    });

    it('Bearbeiter sieht fünf Tabs, aber keine Administration', () => {
      rendereLeiste('bearbeiter');
      for (const name of ['Stücke', 'Inventur', 'Kunden']) {
        expect(tabs().getByRole('link', { name })).toBeInTheDocument();
      }
      expect(tabs().getByRole('button', { name: 'Belege' })).toBeInTheDocument();
      fireEvent.click(tabs().getByRole('button', { name: 'Mehr' }));
      const sheet = screen.getByRole('dialog', { name: 'Mehr' });
      for (const name of ['Dashboard', 'Bestellübersicht', 'SumUp', 'Hilfe']) {
        expect(within(sheet).getByRole('link', { name })).toBeInTheDocument();
      }
      expect(within(sheet).queryByText('Administration')).not.toBeInTheDocument();
      expect(within(sheet).queryByRole('link', { name: 'Audit Log' })).not.toBeInTheDocument();
    });

    it('Admin sieht zusätzlich den Admin-Bereich in Mehr', () => {
      rendereLeiste('admin');
      fireEvent.click(tabs().getByRole('button', { name: 'Mehr' }));
      const sheet = screen.getByRole('dialog', { name: 'Mehr' });
      expect(within(sheet).getByText('Administration')).toBeInTheDocument();
      for (const name of ['Audit Log', 'Debug', 'Benutzerverwaltung', 'Datensicherung']) {
        expect(within(sheet).getByRole('link', { name })).toBeInTheDocument();
      }
    });
  });

  describe('aktiver Tab', () => {
    beforeEach(() => mockeBreite(390));

    it('folgt der Route, auch bei Unterrouten', () => {
      rendereLeiste('bearbeiter', '/schmuckstuecke/MHO123');
      expect(tabs().getByRole('link', { name: 'Stücke' })).toHaveAttribute('aria-current', 'page');
      expect(tabs().getByRole('link', { name: 'Inventur' })).not.toHaveAttribute('aria-current');
    });

    it('Belege ist bei /rechnungen und /lieferscheine aktiv', () => {
      const { unmount } = rendereLeiste('bearbeiter', '/rechnungen');
      expect(tabs().getByRole('button', { name: 'Belege' })).toHaveAttribute('aria-current', 'page');
      unmount();
      rendereLeiste('bearbeiter', '/lieferscheine');
      expect(tabs().getByRole('button', { name: 'Belege' })).toHaveAttribute('aria-current', 'page');
    });

    it('Mehr ist aktiv, wenn die Route ein Eintrag aus dem Sheet ist', () => {
      rendereLeiste('bearbeiter', '/sumup');
      expect(tabs().getByRole('button', { name: 'Mehr' })).toHaveAttribute('aria-current', 'page');
      expect(tabs().getByRole('link', { name: 'Stücke' })).not.toHaveAttribute('aria-current');
    });
  });

  describe('Mehr-Sheet', () => {
    beforeEach(() => mockeBreite(390));

    it('öffnet per Klick und schließt per Escape', () => {
      rendereLeiste('bearbeiter');
      const mehr = tabs().getByRole('button', { name: 'Mehr' });
      expect(mehr).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(mehr);
      expect(screen.getByRole('dialog', { name: 'Mehr' })).toBeInTheDocument();
      expect(mehr).toHaveAttribute('aria-expanded', 'true');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mehr).toHaveFocus();
    });

    it('schließt per Klick daneben', () => {
      rendereLeiste('bearbeiter');
      fireEvent.click(tabs().getByRole('button', { name: 'Mehr' }));
      fireEvent.click(screen.getByTestId('mobile-tabbar-backdrop'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('schließt nach Auswahl eines Eintrags', () => {
      rendereLeiste('bearbeiter');
      fireEvent.click(tabs().getByRole('button', { name: 'Mehr' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Hilfe' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('Benutzerkonto und Abmelden rufen die Handler und schließen das Sheet', () => {
      const onAccount = vi.fn();
      const onLogout = vi.fn();
      rendereLeiste('bearbeiter', '/schmuckstuecke', { onAccount, onLogout });
      fireEvent.click(tabs().getByRole('button', { name: 'Mehr' }));
      fireEvent.click(screen.getByRole('button', { name: /Benutzerkonto/ }));
      expect(onAccount).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.click(tabs().getByRole('button', { name: 'Mehr' }));
      fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
      expect(onLogout).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('Belege-Umschalter', () => {
    beforeEach(() => mockeBreite(390));

    it('zeigt Lieferscheine und Rechnungen und schließt per Escape', () => {
      rendereLeiste('bearbeiter');
      const belege = tabs().getByRole('button', { name: 'Belege' });
      fireEvent.click(belege);
      const gruppe = screen.getByRole('group', { name: 'Belege' });
      expect(within(gruppe).getByRole('link', { name: 'Lieferscheine' })).toHaveAttribute('href', '/lieferscheine');
      expect(within(gruppe).getByRole('link', { name: 'Rechnungen' })).toHaveAttribute('href', '/rechnungen');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('group', { name: 'Belege' })).not.toBeInTheDocument();
    });

    it('schließt nach Auswahl und beim Öffnen von Mehr', () => {
      rendereLeiste('bearbeiter');
      fireEvent.click(tabs().getByRole('button', { name: 'Belege' }));
      fireEvent.click(screen.getByRole('link', { name: 'Rechnungen' }));
      expect(screen.queryByRole('group', { name: 'Belege' })).not.toBeInTheDocument();

      fireEvent.click(tabs().getByRole('button', { name: 'Belege' }));
      fireEvent.click(tabs().getByRole('button', { name: 'Mehr' }));
      expect(screen.queryByRole('group', { name: 'Belege' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Mehr' })).toBeInTheDocument();
    });
  });

  describe('Breite', () => {
    it('wird oberhalb von 768 px nicht gerendert', () => {
      mockeBreite(769);
      rendereLeiste('admin');
      expect(screen.queryByRole('navigation', { name: 'Hauptnavigation mobil' })).not.toBeInTheDocument();
    });

    it('erscheint bei genau 768 px und verschwindet beim Vergrößern', () => {
      const fenster = mockeBreite(768);
      rendereLeiste('admin');
      expect(screen.getByRole('navigation', { name: 'Hauptnavigation mobil' })).toBeInTheDocument();
      act(() => fenster.setze(1200));
      expect(screen.queryByRole('navigation', { name: 'Hauptnavigation mobil' })).not.toBeInTheDocument();
    });
  });
});
