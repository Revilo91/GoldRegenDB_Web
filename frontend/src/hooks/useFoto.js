import { useEffect, useState } from "react";
import { api } from "../api";

// Lädt das Foto zu einer Artikelnummer (null = keins laden).
//
// Ergebnis und Fehler werden mit der Artikelnummer gespeichert, für die sie
// geladen wurden; "lädt" ergibt sich daraus beim Rendern. So setzt der Effekt
// keinen State synchron (react-hooks/set-state-in-effect), und nach einem
// Wechsel der Artikelnummer ist nie kurz das Foto des vorherigen Stücks zu sehen.
//
// pausiert: nichts nachladen, ein schon geladenes Foto bleibt sichtbar
// version: jede Änderung lädt neu, etwa nach dem Speichern des Stücks
export function useFoto(artikelnummer, { pausiert = false, version } = {}) {
  const [stand, setStand] = useState({ fuer: null, src: null, fehler: null });

  useEffect(() => {
    if (!artikelnummer || pausiert) return undefined;
    let verworfen = false;
    const controller = new AbortController();
    api
      .loadPhotoAsDataUrl(artikelnummer, { signal: controller.signal })
      .then((src) => {
        if (!verworfen) setStand({ fuer: artikelnummer, src: src || null, fehler: null });
      })
      .catch((err) => {
        if (!verworfen) setStand({ fuer: artikelnummer, src: null, fehler: err.message });
      });
    return () => {
      verworfen = true;
      controller.abort();
    };
  }, [artikelnummer, pausiert, version]);

  const aktuell = Boolean(artikelnummer) && stand.fuer === artikelnummer;
  return {
    src: aktuell ? stand.src : null,
    fehler: aktuell ? stand.fehler : null,
    laedt: Boolean(artikelnummer) && !pausiert && !aktuell,
  };
}
