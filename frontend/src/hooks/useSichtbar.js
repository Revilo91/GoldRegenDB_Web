import { useCallback, useEffect, useState } from "react";

const VORLAUF = "200px";

// Wird true, sobald das Element in die Nähe des Sichtbereichs kommt, und bleibt dann true.
// Ohne IntersectionObserver (z. B. jsdom, alte Browser) gilt es von Anfang an als sichtbar.
// Rückgabe: [refCallback, sichtbar]
export function useSichtbar() {
  const unterstuetzt = typeof IntersectionObserver !== "undefined";
  const [element, setElement] = useState(null);
  const [gesehen, setGesehen] = useState(false);

  useEffect(() => {
    if (!unterstuetzt || !element || gesehen) return undefined;
    const beobachter = new IntersectionObserver(
      (eintraege) => {
        if (eintraege.some((e) => e.isIntersecting)) {
          setGesehen(true);
          beobachter.disconnect();
        }
      },
      { rootMargin: VORLAUF },
    );
    beobachter.observe(element);
    return () => beobachter.disconnect();
  }, [unterstuetzt, element, gesehen]);

  const ref = useCallback((el) => setElement(el), []);
  return [ref, !unterstuetzt || gesehen];
}
