import { useState } from "react";
import { useToast } from "./Toast";

// Muss zur Prüfung im Backend (rechnungZuruecksetzenSchema) passen
export const MIN_BEGRUENDUNG_ZEICHEN = 10;

// nummer: Rechnungsnummer für den Titel; onBestaetigt(begruendung): ruft die API, wirft bei Fehler
export default function RechnungZuruecksetzenModal({ nummer, onBestaetigt, onClose }) {
  const toast = useToast();
  const [begruendung, setBegruendung] = useState("");
  const [laeuft, setLaeuft] = useState(false);

  const absenden = async () => {
    const text = begruendung.trim();
    if (text.length < MIN_BEGRUENDUNG_ZEICHEN) {
      toast.fehler(`Die Begründung muss mindestens ${MIN_BEGRUENDUNG_ZEICHEN} Zeichen lang sein.`);
      return;
    }
    if (!confirm(`Rechnung ${nummer} wirklich auf Entwurf zurücksetzen? Die Stücke werden wieder freigegeben, die Aktion wird im Audit-Log protokolliert.`)) {
      return;
    }
    setLaeuft(true);
    try {
      await onBestaetigt(text);
    } catch (err) {
      toast.fehler(err.message);
      setLaeuft(false);
    }
  };

  return (
    <div className="modal-overlay modal-overlay-nested">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Rechnung {nummer} zurücksetzen</h3>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="zuruecksetzen-hinweis">
            Die finale Rechnung wird wieder zum Entwurf und danach bearbeitbar. Die Begründung wird zusammen mit Ihrem Benutzernamen im Audit-Log gespeichert.
          </p>
          <div className="form-group form-group-full">
            <label htmlFor="zuruecksetzen-begruendung">Begründung</label>
            <textarea
              id="zuruecksetzen-begruendung"
              className="form-control"
              rows={3}
              maxLength={500}
              value={begruendung}
              onChange={(e) => setBegruendung(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-danger" disabled={laeuft} onClick={absenden}>
            Auf Entwurf zurücksetzen
          </button>
        </div>
      </div>
    </div>
  );
}
