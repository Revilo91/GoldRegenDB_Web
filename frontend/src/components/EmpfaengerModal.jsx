import { useState } from "react";
import { useToast } from "./Toast";

const LEER = { Name: "", Strasse: "", Hausnummer: "", PLZ: "", Ort: "", Land: "DE", Email: "" };
const PFLICHTFELDER = { Name: "Name", Strasse: "Straße", PLZ: "PLZ", Ort: "Ort" };

// Anschrift eines Einmalkunden (Onlineshop-Bestellung). Sie wird nur an der
// Rechnung gespeichert und legt keinen Eintrag in der Kundenliste an.
export default function EmpfaengerModal({ empfaenger, onSave, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ ...LEER, ...empfaenger });

  const feld = (key) => ({
    className: "form-control",
    value: form[key] ?? "",
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  });

  const speichern = () => {
    const bereinigt = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, String(v ?? "").trim()]),
    );
    const fehlend = Object.entries(PFLICHTFELDER)
      .filter(([k]) => !bereinigt[k])
      .map(([, label]) => label);
    if (fehlend.length > 0) {
      toast.fehler(`Bitte ausfüllen: ${fehlend.join(", ")}`);
      return;
    }
    onSave({ ...bereinigt, Land: bereinigt.Land.toUpperCase() || "DE" });
  };

  return (
    <div className="modal-overlay modal-overlay-nested">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Rechnungsempfänger (Einmalkunde)</h3>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="empfaenger-hinweis">
            Für Onlineshop-Bestellungen: Die Anschrift erscheint auf Rechnung und
            E-Rechnung anstelle der des gewählten Kunden.
          </p>
          <div className="modal-form-grid">
            <div className="form-group form-group-full">
              <label htmlFor="empf-name">Name*</label>
              <input id="empf-name" maxLength={100} autoFocus {...feld("Name")} />
            </div>
            <div className="form-group">
              <label htmlFor="empf-strasse">Straße*</label>
              <input id="empf-strasse" maxLength={200} {...feld("Strasse")} />
            </div>
            <div className="form-group">
              <label htmlFor="empf-hausnummer">Hausnummer</label>
              <input id="empf-hausnummer" maxLength={20} {...feld("Hausnummer")} />
            </div>
            <div className="form-group">
              <label htmlFor="empf-plz">PLZ*</label>
              <input id="empf-plz" maxLength={10} {...feld("PLZ")} />
            </div>
            <div className="form-group">
              <label htmlFor="empf-ort">Ort*</label>
              <input id="empf-ort" maxLength={100} {...feld("Ort")} />
            </div>
            <div className="form-group">
              <label htmlFor="empf-land">Land (ISO-Code)</label>
              <input id="empf-land" maxLength={2} placeholder="DE" {...feld("Land")} />
            </div>
            <div className="form-group">
              <label htmlFor="empf-email">Email (für XRechnung erforderlich)</label>
              <input id="empf-email" type="email" maxLength={200} {...feld("Email")} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={speichern}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
