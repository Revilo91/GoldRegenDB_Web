import TablePhoto from "./TablePhoto";
import { statusBadge, statusVon } from "../utils/status";
import { formatEur } from "../utils/zahlen";

// Kompakte Zeile: Foto, Artikelnummer, Name/Art, Preis, Status-Punkt.
// onClick: macht die Zeile zum Button (Detail-Panel); ohne bleibt sie ein reines Anzeige-Element.
// aktiv: hebt die ausgewählte Zeile hervor. kundenName: nennt bei Ausgelagert den Kunden.
export default function SchmuckstueckZeile({ stueck, onClick, aktiv = false, pauseLoading = false, kundenName }) {
  const [basis, exemplar] = String(stueck.Artikelnummer).split("_");
  const unterzeile = [stueck.Name, stueck.Art].filter(Boolean).join(" · ");
  const preis = Number(stueck.Verkaufspreis) > 0 ? formatEur(stueck.Verkaufspreis) : "-";
  const { label } = statusBadge(stueck, kundenName);

  const inhalt = (
    <>
      <TablePhoto hatFoto={stueck.hatFoto} artikelnummer={stueck.Artikelnummer} pauseLoading={pauseLoading} />
      <span className="schmuckstueck-zeile-text">
        <span className="schmuckstueck-zeile-nummer">
          <strong>{basis}</strong>
          {exemplar > 0 && <span className="badge warning">{exemplar}</span>}
        </span>
        {unterzeile && <span className="schmuckstueck-zeile-unter">{unterzeile}</span>}
      </span>
      <span className="schmuckstueck-zeile-preis">{preis}</span>
      <span
        role="img"
        aria-label={label}
        title={label}
        className={`schmuckstueck-zeile-punkt schmuckstueck-zeile-punkt--${statusVon(stueck)}`}
      />
    </>
  );

  const klassen = `schmuckstueck-zeile${aktiv ? " schmuckstueck-zeile--aktiv" : ""}`;
  if (!onClick) return <div className={klassen}>{inhalt}</div>;
  return (
    <button type="button" className={klassen} aria-pressed={aktiv} onClick={() => onClick(stueck)}>
      {inhalt}
    </button>
  );
}
