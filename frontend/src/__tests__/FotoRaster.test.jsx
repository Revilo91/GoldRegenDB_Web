import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import FotoRaster from '../components/FotoRaster';

vi.mock('../api', () => ({
  api: { loadPhotoAsDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') },
}));

import { api } from '../api';

const stueck = (nr, extra = {}) => ({
  Artikelnummer: nr,
  Name: 'Seerose',
  Art: 'Ohrring',
  Verkaufspreis: '24.5',
  Ausgelagert: 0,
  Verkauft: false,
  Ausschuss: false,
  hatFoto: true,
  ...extra,
});

// Gemockter IntersectionObserver: merkt sich Beobachter, Test löst sie gezielt aus.
let beobachter;
class FalscherObserver {
  constructor(callback) {
    this.callback = callback;
    this.elemente = [];
    this.disconnect = vi.fn();
    beobachter.push(this);
  }
  observe(el) {
    this.elemente.push(el);
  }
  unobserve() {}
  zeige(el) {
    this.callback([{ target: el, isIntersecting: true }]);
  }
}

describe('FotoRaster', () => {
  beforeEach(() => {
    api.loadPhotoAsDataUrl.mockClear();
    beobachter = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('zeigt je Kachel Nummer, Preis, Name und Status-Badge', () => {
    render(<FotoRaster stuecke={[stueck('MHO123_2'), stueck('MBA5', { Verkauft: true, Name: 'Welle' })]} onSelect={() => {}} />);

    expect(screen.getByText('MHO123')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Seerose')).toBeInTheDocument();
    expect(screen.getAllByText(/24,50/)).toHaveLength(2);
    expect(screen.getByText('Lager')).toBeInTheDocument();
    expect(screen.getByText('Verkauft')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('nennt bei Ausgelagert den Kunden im Badge', () => {
    render(
      <FotoRaster stuecke={[stueck('MHO1', { Ausgelagert: 7 })]} onSelect={() => {}} kundenName={(id) => `Laden ${id}`} />,
    );
    expect(screen.getByText('Laden 7')).toBeInTheDocument();
  });

  it('ruft beim Klick onSelect mit dem Stück auf', () => {
    const onSelect = vi.fn();
    const s = stueck('MHO123_2');
    render(<FotoRaster stuecke={[s]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(s);
  });

  it('lädt ohne IntersectionObserver das Foto sofort', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<FotoRaster stuecke={[stueck('MHO1'), stueck('MHO2')]} onSelect={() => {}} />);

    await waitFor(() => expect(api.loadPhotoAsDataUrl).toHaveBeenCalledTimes(2));
  });

  it('lädt das Foto erst, wenn die Kachel in die Nähe des Sichtbereichs kommt', async () => {
    vi.stubGlobal('IntersectionObserver', FalscherObserver);
    render(<FotoRaster stuecke={[stueck('MHO1'), stueck('MHO2')]} onSelect={() => {}} />);

    expect(api.loadPhotoAsDataUrl).not.toHaveBeenCalled();

    const kachel = beobachter[0].elemente[0];
    act(() => beobachter[0].zeige(kachel));

    await waitFor(() => expect(api.loadPhotoAsDataUrl).toHaveBeenCalledTimes(1));
    expect(api.loadPhotoAsDataUrl.mock.calls[0][0]).toBe('MHO1');
    expect(beobachter[0].disconnect).toHaveBeenCalled();
  });

  it('beobachtet mit Vorlauf (rootMargin) und lädt Stücke ohne Foto nie', async () => {
    const optionen = [];
    class MerkeOptionen extends FalscherObserver {
      constructor(cb, opt) {
        super(cb);
        optionen.push(opt);
      }
    }
    vi.stubGlobal('IntersectionObserver', MerkeOptionen);
    render(<FotoRaster stuecke={[stueck('MHO3', { hatFoto: false })]} onSelect={() => {}} />);

    expect(optionen[0].rootMargin).toBe('200px');
    act(() => beobachter[0].zeige(beobachter[0].elemente[0]));
    await act(async () => {});
    expect(api.loadPhotoAsDataUrl).not.toHaveBeenCalled();
  });

  it('lädt nichts, solange pauseLoading gesetzt ist, auch wenn sichtbar', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<FotoRaster stuecke={[stueck('MHO1')]} onSelect={() => {}} pauseLoading />);

    await act(async () => {});
    expect(api.loadPhotoAsDataUrl).not.toHaveBeenCalled();
  });
});
