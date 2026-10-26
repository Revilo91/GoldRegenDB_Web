import { useCallback, useSyncExternalStore } from "react";

// Ob die Media-Query gerade zutrifft; aktualisiert sich beim Ändern der Fensterbreite.
// Ohne window.matchMedia (z. B. jsdom) gilt false.
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (melden) => {
      if (!window.matchMedia) return () => {};
      const abfrage = window.matchMedia(query);
      abfrage.addEventListener("change", melden);
      return () => abfrage.removeEventListener("change", melden);
    },
    [query],
  );
  const momentaufnahme = () => (window.matchMedia ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, momentaufnahme, () => false);
}
