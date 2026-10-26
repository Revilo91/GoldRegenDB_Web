import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MOBILE_BREAKPOINT, MOBILE_QUERY, PANEL_BREAKPOINT, PANEL_QUERY } from '../utils/breakpoints';
import { mockeBreite } from './helpers/matchMedia';

describe('useMediaQuery', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('nutzt dieselbe Schwelle wie die Seitenleiste (768 px)', () => {
    expect(MOBILE_BREAKPOINT).toBe(768);
    expect(MOBILE_QUERY).toBe('(max-width: 768px)');
  });

  it('schaltet das Detail-Panel ab 1024 px ein', () => {
    expect(PANEL_BREAKPOINT).toBe(1024);
    expect(PANEL_QUERY).toBe('(min-width: 1024px)');
    const fenster = mockeBreite(1023);
    const { result } = renderHook(() => useMediaQuery(PANEL_QUERY));
    expect(result.current).toBe(false);
    act(() => fenster.setze(1024));
    expect(result.current).toBe(true);
  });

  it('liefert den aktuellen Treffer der Abfrage', () => {
    mockeBreite(390);
    const { result } = renderHook(() => useMediaQuery(MOBILE_QUERY));
    expect(result.current).toBe(true);
  });

  it('liefert false oberhalb der Schwelle', () => {
    mockeBreite(1200);
    const { result } = renderHook(() => useMediaQuery(MOBILE_QUERY));
    expect(result.current).toBe(false);
  });

  it('reagiert auf Änderungen der Fensterbreite', () => {
    const fenster = mockeBreite(1200);
    const { result } = renderHook(() => useMediaQuery(MOBILE_QUERY));
    act(() => fenster.setze(500));
    expect(result.current).toBe(true);
  });

  it('liefert false, wenn matchMedia fehlt', () => {
    delete window.matchMedia;
    const { result } = renderHook(() => useMediaQuery(MOBILE_QUERY));
    expect(result.current).toBe(false);
  });
});
