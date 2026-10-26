import TablePhoto from "./TablePhoto";
import { useSichtbar } from "../hooks/useSichtbar";
import { statusBadge } from "../utils/status";
import { formatEur } from "../utils/zahlen";

// Auf Modulebene (nicht im Render-Body anderer Komponenten), siehe Kommentar in TablePhoto.jsx.
// Das Foto wird erst geladen, wenn die Kachel nahe am Sichtbereich ist (useFoto lädt beim Mount,
// loading="lazy" am img würde den Abruf nicht verzögern).
function FotoKachel({ stueck, onSelect, pauseLoading, kundenName, aktiv, markierbar }) {
  const [ref, sichtbar] = useSichtbar();
  const [basis, exemplar] = String(stueck.Artikelnummer).split("_");
  const preis = Number(stueck.Verkaufspreis) > 0 ? formatEur(stueck.Verkaufspreis) : "-";
  const badge = statusBadge(stueck, kundenName);

  return (
    <button
      type="button"
      ref={ref}
      className={`foto-kachel${aktiv ? " foto-kachel--aktiv" : ""}`}
      aria-pressed={markierbar ? aktiv : undefined}
      onClick={() => onSelect(stueck)}>
      <span className="foto-kachel-bild">
        <TablePhoto
          groesse="gross"
          hatFoto={stueck.hatFoto}
          artikelnummer={stueck.Artikelnummer}
          pauseLoading={pauseLoading || !sichtbar}
        />
        <span className={`${badge.klasse} foto-kachel-status`}>{badge.label}</span>
      </span>
      <span className="foto-kachel-nummer">
        <strong>{basis}</strong>
        {exemplar > 0 && <span className="badge warning">{exemplar}</span>}
      </span>
      <span className="foto-kachel-preis">{preis}</span>
      {stueck.Name && <span className="foto-kachel-name">{stueck.Name}</span>}
    </button>
  );
}

// stuecke: Datenzeilen der Liste; onSelect(stueck): wie Zeilenklick der Tabelle
// aktiveArtikelnummer: (optional) hebt die gewählte Kachel hervor, wenn daneben ein Detail-Panel steht
export default function FotoRaster({ stuecke, onSelect, pauseLoading = false, kundenName, aktiveArtikelnummer }) {
  return (
    <div className="foto-raster">
      {stuecke.map((s) => (
        <FotoKachel
          key={s.Artikelnummer}
          stueck={s}
          onSelect={onSelect}
          pauseLoading={pauseLoading}
          kundenName={kundenName}
          markierbar={aktiveArtikelnummer !== undefined}
          aktiv={s.Artikelnummer === aktiveArtikelnummer}
        />
      ))}
    </div>
  );
}
