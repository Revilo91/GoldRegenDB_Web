import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGem } from "@fortawesome/free-solid-svg-icons";
import { useFoto } from "../hooks/useFoto";

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
// groesse="gross": Variante für das Foto-Raster (füllt die Kachel); Standard ist die Tabellengröße.
export default function TablePhoto({ hatFoto, artikelnummer, pauseLoading = false, groesse }) {
  const gross = groesse === "gross" ? " table-photo--gross" : "";
  const {
    src: photoSrc,
    laedt: isLoading,
    fehler: photoError,
  } = useFoto(hatFoto ? artikelnummer : null, { pausiert: pauseLoading });

  if (!photoSrc) {
    return (
      <span
        className={`table-photo-placeholder${gross}`}
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
      className={`table-photo-thumb${gross}`}
      src={photoSrc}
      alt={`Foto ${artikelnummer}`}
      title={`Foto ${artikelnummer}`}
      loading="lazy"
    />
  );
}
