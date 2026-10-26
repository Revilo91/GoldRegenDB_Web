import { render, screen, fireEvent } from '@testing-library/react';
import SchmuckstueckZeile from '../components/SchmuckstueckZeile';

vi.mock('../api', () => ({
  api: { loadPhotoAsDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') },
}));

import { api } from '../api';

const stueck = {
  Artikelnummer: 'MHO123_2',
  Name: 'Seerose',
  Art: 'Ohrring',
  Verkaufspreis: '24.5',
  Ausgelagert: 0,
  Verkauft: false,
  Ausschuss: false,
  hatFoto: true,
};

describe('SchmuckstueckZeile', () => {
  beforeEach(() => api.loadPhotoAsDataUrl.mockClear());

  it('zeigt Artikelnummer, Name und Art, Preis', () => {
    render(<SchmuckstueckZeile stueck={stueck} />);
    expect(screen.getByText('MHO123')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Seerose · Ohrring')).toBeInTheDocument();
    expect(screen.getByText(/24,50/)).toBeInTheDocument();
  });

  it('zeigt einen Strich ohne Preis und lässt leere Zeilenteile weg', () => {
    render(<SchmuckstueckZeile stueck={{ ...stueck, Verkaufspreis: 0, Name: '', Art: 'Ohrring' }} />);
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('Ohrring')).toBeInTheDocument();
  });

  it.each([
    [{}, 'lager', 'Lager'],
    [{ Ausgelagert: 4 }, 'ausgelagert', 'Ausgelagert'],
    [{ Verkauft: true }, 'verkauft', 'Verkauft'],
    [{ Ausschuss: true, Verkauft: true }, 'ausschuss', 'Ausschuss'],
  ])('zeigt den Statuspunkt für %j', (abweichung, status, label) => {
    render(<SchmuckstueckZeile stueck={{ ...stueck, ...abweichung }} />);
    const punkt = screen.getByRole('img', { name: label });
    expect(punkt).toHaveClass('schmuckstueck-zeile-punkt', `schmuckstueck-zeile-punkt--${status}`);
  });

  it('nennt bei ausgelagerten Stücken den Kunden, wenn kundenName gegeben ist', () => {
    render(<SchmuckstueckZeile stueck={{ ...stueck, Ausgelagert: 4 }} kundenName={() => 'Laden Mitte'} />);
    expect(screen.getByRole('img', { name: 'Laden Mitte' })).toHaveClass('schmuckstueck-zeile-punkt--ausgelagert');
  });

  it('lädt das Foto, außer pauseLoading ist gesetzt', () => {
    const { unmount } = render(<SchmuckstueckZeile stueck={stueck} pauseLoading />);
    expect(api.loadPhotoAsDataUrl).not.toHaveBeenCalled();
    unmount();
    render(<SchmuckstueckZeile stueck={stueck} />);
    expect(api.loadPhotoAsDataUrl).toHaveBeenCalledWith('MHO123_2', expect.anything());
  });

  it('ist ohne onClick kein Button', () => {
    render(<SchmuckstueckZeile stueck={stueck} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('löst onClick mit dem Stück aus', () => {
    const onClick = vi.fn();
    render(<SchmuckstueckZeile stueck={stueck} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(stueck);
  });

  it('hebt die Auswahl hervor und setzt aria-pressed', () => {
    const { container } = render(<SchmuckstueckZeile stueck={stueck} onClick={() => {}} aktiv />);
    expect(container.firstChild).toHaveClass('schmuckstueck-zeile--aktiv');
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
