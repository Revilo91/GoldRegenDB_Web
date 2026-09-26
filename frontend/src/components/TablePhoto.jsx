import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGem } from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";

// Thumbnail für eine Tabellenzeile.
//
// Die Komponente lag zweimal im Projekt: in Inventur.jsx korrekt auf
// Modulebene, in Schmuckstuecke.jsx aber INNERHALB der Seitenkomponente
// deklariert. Eine im Render-Body deklarierte Komponente ist bei jedem
// Parent-Render ein neuer Komponententyp – React unmountet und remountet dann
// den ganzen Teilbaum, und photoSrc fällt auf null zurück. Sichtbar wurde das
// als "alle Thumbnails werden bei jedem Tastendruck zu Platzhaltern", und beim
// Öffnen eines Modals blieben sie leer, weil pauseLoading das Nachladen
// unterdrückt (Befund G1).
export default function TablePhoto({ hatFoto, artikelnummer, pauseLoading = false }) {
  const [photoSrc, setPhotoSrc] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [photoError, setPhotoError] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    const abbrechen = () => {
      isCancelled = true;
      controller.abort();
    };

    if (!hatFoto || !artikelnummer) {
      setPhotoSrc(null);
      setPhotoError(null);
      setIsLoading(false);
      return abbrechen;
    }

    if (pauseLoading) {
      setIsLoading(false);
      return abbrechen;
    }

    setIsLoading(true);
    setPhotoError(null);
    api
      .loadPhotoAsDataUrl(artikelnummer, { signal: controller.signal })
      .then((dataUrl) => {
        if (isCancelled) return;
        setPhotoSrc(dataUrl);
      })
      .catch((err) => {
        if (isCancelled) return;
        setPhotoSrc(null);
        setPhotoError(err.message);
      })
      .finally(() => {
        if (isCancelled) return;
        setIsLoading(false);
      });

    return abbrechen;
  }, [hatFoto, artikelnummer, pauseLoading]);

  if (!photoSrc) {
    return (
      <span
        className="table-photo-placeholder"
        title={
          isLoading
            ? "Foto wird geladen"
            : photoError
              ? `Foto konnte nicht geladen werden: ${photoError}`
              : "Kein Foto verfügbar"
        }>
        <FontAwesomeIcon icon={faGem} />
      </span>
    );
  }

  return (
    <img
      className="table-photo-thumb"
      src={photoSrc}
      alt={`Foto ${artikelnummer}`}
      title={`Foto ${artikelnummer}`}
      loading="lazy"
    />
  );
}
