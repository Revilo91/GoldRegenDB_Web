import { render, screen, fireEvent } from '@testing-library/react';
import StatusChips from '../components/StatusChips';
import { STATUS } from '../utils/status';
import { STATUS_ALLE, statusListenParams } from '../utils/statusFilter';

const ZAHLEN = { alle: 100, lager: 60, ausgelagert: 20, verkauft: 15, ausschuss: 5 };

function rendere(props = {}) {
  const onChange = vi.fn();
  render(<StatusChips wert={STATUS_ALLE} zahlen={ZAHLEN} onChange={onChange} {...props} />);
  return onChange;
}

describe('StatusChips', () => {
  it('zeigt fünf Chips mit Name und Zahl', () => {
    rendere();
    expect(screen.getByRole('button', { name: /^Alle\s*100$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Im Lager\s*60$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ausgelagert\s*20$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Verkauft\s*15$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ausschuss\s*5$/ })).toBeInTheDocument();
  });

  it('zeigt einen Strich statt der Zahl, solange keine Zahlen da sind', () => {
    rendere({ zahlen: null });
    expect(screen.getByRole('button', { name: /^Alle\s*–$/ })).toBeInTheDocument();
  });

  it('markiert genau den aktiven Chip mit aria-pressed', () => {
    rendere({ wert: STATUS.VERKAUFT });
    const chips = screen.getAllByRole('button');
    expect(chips.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Verkauft/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Alle/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('ruft onChange mit dem Statuswert des angeklickten Chips', () => {
    const onChange = rendere();
    fireEvent.click(screen.getByRole('button', { name: /^Im Lager/ }));
    expect(onChange).toHaveBeenCalledWith(STATUS.LAGER);
    fireEvent.click(screen.getByRole('button', { name: /^Ausgelagert/ }));
    expect(onChange).toHaveBeenCalledWith(STATUS.AUSGELAGERT);
    fireEvent.click(screen.getByRole('button', { name: /^Ausschuss/ }));
    expect(onChange).toHaveBeenCalledWith(STATUS.AUSSCHUSS);
  });

  it('setzt per Klick auf den aktiven Chip zurück', () => {
    const onChange = rendere({ wert: STATUS.AUSSCHUSS });
    fireEvent.click(screen.getByRole('button', { name: /^Ausschuss/ }));
    expect(onChange).toHaveBeenCalledWith(STATUS_ALLE);
  });

  it('setzt per Klick auf "Alle" zurück', () => {
    const onChange = rendere({ wert: STATUS.LAGER });
    fireEvent.click(screen.getByRole('button', { name: /^Alle/ }));
    expect(onChange).toHaveBeenCalledWith(STATUS_ALLE);
  });

  it('ist per Tastatur bedienbar: echte Buttons, Tab-fähig', () => {
    rendere();
    const chip = screen.getByRole('button', { name: /^Verkauft/ });
    expect(chip.tagName).toBe('BUTTON');
    expect(chip).toHaveAttribute('type', 'button');
    expect(chip).not.toHaveAttribute('tabindex', '-1');
  });
});

describe('statusListenParams', () => {
  it('Alle: keine Statusparameter', () => {
    expect(statusListenParams(STATUS_ALLE, [1, 2])).toEqual({});
  });

  it('Im Lager: Lager UND nicht verkauft UND kein Ausschuss', () => {
    expect(statusListenParams(STATUS.LAGER, [1, 2])).toEqual({
      ausgelagert: '0',
      verkauft: '0',
      ausschuss: '0',
    });
  });

  it('Ausgelagert: alle Kunden als ID-Liste, nicht verkauft, kein Ausschuss', () => {
    expect(statusListenParams(STATUS.AUSGELAGERT, [3, 7, 12])).toEqual({
      ausgelagert: '3,7,12',
      verkauft: '0',
      ausschuss: '0',
    });
  });

  it('Verkauft und Ausschuss setzen je ihren Parameter', () => {
    expect(statusListenParams(STATUS.VERKAUFT, [])).toEqual({ verkauft: '1' });
    expect(statusListenParams(STATUS.AUSSCHUSS, [])).toEqual({ ausschuss: '1' });
  });
});
