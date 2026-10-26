import { STATUS } from "../utils/status";
import { STATUS_ALLE } from "../utils/statusFilter";

const CHIPS = [
  { wert: STATUS_ALLE, label: "Alle" },
  { wert: STATUS.LAGER, label: "Im Lager" },
  { wert: STATUS.AUSGELAGERT, label: "Ausgelagert" },
  { wert: STATUS.VERKAUFT, label: "Verkauft" },
  { wert: STATUS.AUSSCHUSS, label: "Ausschuss" },
];

// wert: aktiver Chip (STATUS_ALLE oder STATUS.*); zahlen: { alle, lager, ... } oder null;
// onChange(wert): erneuter Klick auf den aktiven Chip meldet STATUS_ALLE.
export default function StatusChips({ wert, zahlen, onChange }) {
  return (
    <div className="status-chips" role="group" aria-label="Status filtern">
      {CHIPS.map((chip) => {
        const aktiv = chip.wert === wert;
        return (
          <button
            key={chip.wert}
            type="button"
            className={`status-chip${aktiv ? " status-chip--aktiv" : ""}`}
            aria-pressed={aktiv}
            onClick={() => onChange(aktiv ? STATUS_ALLE : chip.wert)}>
            <span className={`status-chip-punkt status-chip-punkt--${chip.wert}`} aria-hidden="true" />
            <span className="status-chip-label">{chip.label}</span>
            <span className="status-chip-zahl">{zahlen ? zahlen[chip.wert] : "–"}</span>
          </button>
        );
      })}
    </div>
  );
}
