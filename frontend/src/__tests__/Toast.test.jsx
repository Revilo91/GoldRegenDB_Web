import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { rendereMitToast } from './helpers/rendern';
import { useToast } from '../components/Toast';

// Kleine Testkomponente: loest Toasts per Klick aus, damit der Hook im Baum
// laeuft und nicht direkt aufgerufen werden muss.
function Ausloeser({ text = 'Etwas ist schiefgelaufen' }) {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.fehler(text)}>Fehler</button>
      <button onClick={() => toast.erfolg('Gespeichert')}>Erfolg</button>
    </>
  );
}

describe('Toast', () => {
  it('zeigt eine Fehlermeldung als role="alert"', async () => {
    rendereMitToast(<Ausloeser />);

    fireEvent.click(screen.getByText('Fehler'));

    const meldung = await screen.findByRole('alert');
    expect(meldung).toHaveTextContent('Etwas ist schiefgelaufen');
  });

  it('fasst dieselbe Meldung zusammen statt sie zu stapeln', async () => {
    // Genau der Fall aus Befund G19: die Liste feuerte pro Tastendruck einen
    // Fehler, und alert() ergab daraus mehrere Dialoge hintereinander.
    rendereMitToast(<Ausloeser />);

    fireEvent.click(screen.getByText('Fehler'));
    fireEvent.click(screen.getByText('Fehler'));
    fireEvent.click(screen.getByText('Fehler'));

    expect(await screen.findAllByRole('alert')).toHaveLength(1);
  });

  it('unterscheidet Erfolg von Fehler', async () => {
    rendereMitToast(<Ausloeser />);

    fireEvent.click(screen.getByText('Fehler'));
    fireEvent.click(screen.getByText('Erfolg'));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText('Gespeichert')).toBeInTheDocument();
  });

  it('laesst sich ueber den Schließen-Button entfernen', async () => {
    rendereMitToast(<Ausloeser />);
    fireEvent.click(screen.getByText('Fehler'));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Meldung schließen' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blendet eine Meldung nach ihrer Anzeigedauer selbst aus', async () => {
    vi.useFakeTimers();
    try {
      rendereMitToast(<Ausloeser />);
      fireEvent.click(screen.getByText('Fehler'));
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Fehler bleiben 8 Sekunden stehen.
      act(() => vi.advanceTimersByTime(8000));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('wirft ohne Provider, statt Meldungen still zu verschlucken', () => {
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Ausloeser />)).toThrow(/ToastProvider/);
    } finally {
      konsole.mockRestore();
    }
  });
});
