import { useState } from "react";
import { publicApi } from "../api";

const EMPTY_FORM = {
  versandart: "abholung",
  wunschdatum: "",
  beschreibung: "",
  kunde: { name: "", email: "", telefonnummer: "", strasse: "", hausnummer: "", plz: "", ort: "" },
  consentErteilt: false,
  webseite: "", // Honeypot – bleibt für Menschen unsichtbar und leer
};

export default function BestellungPublic() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [bestellnummer, setBestellnummer] = useState(null);

  const updateKundeField = (field, value) =>
    setForm((f) => ({ ...f, kunde: { ...f.kunde, [field]: value } }));

  const isLieferung = form.versandart === "lieferung";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.consentErteilt) {
      setError("Bitte stimmen Sie der Verarbeitung Ihrer Daten zu.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await publicApi.createBestellung({
        versandart: form.versandart,
        wunschdatum: form.wunschdatum || null,
        beschreibung: form.beschreibung,
        kunde: form.kunde,
        consent: { erteilt: form.consentErteilt },
        webseite: form.webseite,
      });
      setBestellnummer(res.bestellnummer);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (bestellnummer) {
    return (
      <div className="public-order-page">
        <div className="public-order-card public-order-success">
          <img src="/Logo trasparent weißer Kreis.png" alt="GoldRegen" className="public-order-logo" />
          <h2>Vielen Dank für Ihre Bestellung!</h2>
          <p>
            Ihre Bestellung wurde erfolgreich übermittelt. Ihre Bestellnummer lautet:
          </p>
          <p className="public-order-number">{bestellnummer}</p>
          <p>Wir melden uns bei Ihnen, sobald Ihre Bestellung bearbeitet wurde.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-order-page">
      <form className="public-order-card" onSubmit={handleSubmit}>
        <img src="/Logo trasparent weißer Kreis.png" alt="GoldRegen" className="public-order-logo" />
        <h2>Bestellung aufgeben</h2>
        <p className="public-order-intro">
          Füllen Sie das Formular aus, um eine Bestellung bei uns aufzugeben. Mit * markierte Felder sind erforderlich.
        </p>

        {error && <div className="alert alert-danger">{error}</div>}

        {/* Honeypot-Feld: für Menschen unsichtbar, Bots füllen es häufig automatisch aus */}
        <div className="public-order-honeypot" aria-hidden="true">
          <label htmlFor="webseite">Webseite</label>
          <input
            id="webseite"
            name="webseite"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.webseite}
            onChange={(e) => setForm({ ...form, webseite: e.target.value })}
          />
        </div>

        <div className="modal-form-grid">
          <div className="form-group">
            <label className="form-label">Versandart *</label>
            <select
              className="form-control"
              value={form.versandart}
              onChange={(e) => setForm({ ...form, versandart: e.target.value })}
            >
              <option value="abholung">Abholung</option>
              <option value="lieferung">Lieferung</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Wunschdatum</label>
            <input
              type="date"
              className="form-control"
              value={form.wunschdatum}
              onChange={(e) => setForm({ ...form, wunschdatum: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Name *</label>
            <input
              className="form-control"
              required
              value={form.kunde.name}
              onChange={(e) => updateKundeField("name", e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">E-Mail {!isLieferung && "*"}</label>
            <input
              type="email"
              className="form-control"
              required={!isLieferung}
              value={form.kunde.email}
              onChange={(e) => updateKundeField("email", e.target.value)}
            />
          </div>

          {isLieferung && (
            <>
              <div className="form-group">
                <label className="form-label">Telefonnummer *</label>
                <input
                  className="form-control"
                  required
                  value={form.kunde.telefonnummer}
                  onChange={(e) => updateKundeField("telefonnummer", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Straße *</label>
                <input
                  className="form-control"
                  required
                  value={form.kunde.strasse}
                  onChange={(e) => updateKundeField("strasse", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Hausnummer *</label>
                <input
                  className="form-control"
                  required
                  value={form.kunde.hausnummer}
                  onChange={(e) => updateKundeField("hausnummer", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">PLZ *</label>
                <input
                  className="form-control"
                  required
                  value={form.kunde.plz}
                  onChange={(e) => updateKundeField("plz", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Ort *</label>
                <input
                  className="form-control"
                  required
                  value={form.kunde.ort}
                  onChange={(e) => updateKundeField("ort", e.target.value)}
                />
              </div>
            </>
          )}

          <div className="form-group form-group-full">
            <label className="form-label">Auftragsbeschreibung *</label>
            <textarea
              className="form-control"
              rows={4}
              required
              maxLength={2000}
              value={form.beschreibung}
              onChange={(e) => setForm({ ...form, beschreibung: e.target.value })}
            />
          </div>

          <div className="form-group form-group-full">
            <label className="form-label">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={form.consentErteilt}
                onChange={(e) => setForm({ ...form, consentErteilt: e.target.checked })}
              />{" "}
              Ich stimme der Verarbeitung meiner Daten zur Bearbeitung dieser Bestellung gemäß der
              Datenschutzerklärung zu. *
            </label>
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={submitting || !form.consentErteilt}>
          {submitting ? "Wird übermittelt..." : "Bestellung absenden"}
        </button>
      </form>
    </div>
  );
}
