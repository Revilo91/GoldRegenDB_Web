import React, { useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilePdf, faFileExcel, faTimes, faSpinner } from "@fortawesome/free-solid-svg-icons";

export default function DocumentPreview({ type, data, onClose, onExportExcel, onExportPdf }) {
  const [pdfLoading, setPdfLoading] = useState(false);

  const handleExportPdf = async () => {
    setPdfLoading(true);
    try {
      await onExportPdf();
    } catch (err) {
      alert("PDF-Generierung fehlgeschlagen: " + err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  const getMaterialName = (artikelnummer) => {
    const code = (artikelnummer || "")[1];
    const map = {
      A: "Alkoholtinte", B: "Beton", C: "Cucio", E: "Edelstahl",
      F: "Fimo", H: "Harz", I: "Phiole", J: "Papier", K: "Kordel",
      L: "Leder", M: "Makramee", N: "Naturstein", P: "Perle",
      S: "Schrumpffolie", W: "Holz", X: "3D-Druck", Y: "Cabochon"
    };
    return map[code] || "";
  };

  const getBezeichnung = (s, artNrBasis) => {
    const getVal = (val) => (val && val !== "0" && val !== 0 ? val : "-");
    const artCode = artNrBasis[2];
    const artikelTyp =
      artCode === "H" ? "Halskette" :
      artCode === "O" ? "Ohrring" :
      artCode === "A" ? "Armband" :
      artCode === "S" ? "Schlüsselanhänger" : "";

    if (s.Name && s.Name.trim()) {
      return `${artikelTyp}: ${s.Name}`;
    } else if (artikelTyp === "Ohrring") {
      return `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Form)} ${getVal(s.Fassung)} ${getVal(s.Farbe)}, ${getVal(s.Inhalt_Zusatzmaterial)}`;
    } else if (artikelTyp === "Halskette") {
      return `${artikelTyp}: Fassung ${getVal(s.Anhänger_Fassung)} ${getVal(s.Anhänger_Form)}, ${getVal(s.Anhänger_Inhalt_Farbe)} ${getVal(s.Anhänger_Inhalt_Zusatzmaterial)}`;
    } else if (artikelTyp === "Armband") {
      return `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Farbe)}, ${getVal(s.Anhänger)}, ${getVal(s.Zwischenstück)}`;
    } else if (artikelTyp === "Schlüsselanhänger") {
      return `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Form)}`;
    }
    return `${s.Art || ""}: ${s.Material || ""} ${s.Farbe || ""}`;
  };

  const parseItems = () => {
    const counts = {};
    const processed = [];
    (data.schmuckstuecke || []).forEach(s => {
      const artNrBasis = (s.Artikelnummer || "").split("_")[0];
      if (!counts[artNrBasis]) {
        counts[artNrBasis] = 0;
        processed.push({ ...s, artNrBasis });
      }
      counts[artNrBasis]++;
    });
    return processed.map(p => ({
      ...p,
      menge: counts[p.artNrBasis]
    })).sort((a,b) => a.artNrBasis.localeCompare(b.artNrBasis));
  };

  const items = parseItems();
  const datum = new Date(data.Datum).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });

  const totalBrutto = data.schmuckstuecke?.reduce((sum, s) => sum + (Number(s.Verkaufspreis) || 0), 0) || 0;
  const provisionPercent = Number(data.Provision || (data.kunde?.Provision) || 0);
  const provisionValue = totalBrutto * (provisionPercent / 100);
  const finalTotal = totalBrutto - provisionValue;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div className="modal document-preview-modal" onClick={e => e.stopPropagation()} style={{ background: '#f0f2f5', width: '90vw', maxWidth: '1000px', height: '90vh' }}>
        
        <div className="modal-header" style={{ background: 'var(--bg-card)' }}>
          <h3>Vorschau: {type} {data.Nummer}</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={onExportExcel}>
              <FontAwesomeIcon icon={faFileExcel} /> Als Excel
            </button>
            <button className="btn btn-primary" onClick={handleExportPdf} disabled={pdfLoading}>
              <FontAwesomeIcon icon={pdfLoading ? faSpinner : faFilePdf} spin={pdfLoading} /> {pdfLoading ? "Wird erstellt..." : "Als PDF"}
            </button>
            <button className="modal-close" onClick={onClose}>
              <FontAwesomeIcon icon={faTimes} />
            </button>
          </div>
        </div>

        <div className="modal-body preview-scroll-area" style={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
          
          <div className="a4-page preview-document">
            
            <div className="doc-top-section">
              <div className="doc-logo-container">
                <img src="/Logo trasparent weißer Kreis.png" alt="Goldregen Logo" className="doc-logo" />
              </div>
              
              <div className="doc-sender-line">
                Marina Südholt • Herzogin-Ludmilla-Ring 5 • 84085 Langquaid
              </div>

              <div className="doc-address">
                <div>{data.KundenName || (data.kunde && data.kunde.Name)}</div>
                {data.kunde && (
                  <div>
                    {data.kunde.Strasse} {data.kunde.Hausnummer}<br/>
                    {data.kunde.PLZ} {data.kunde.Ort}
                  </div>
                )}
              </div>
            </div>

            <div className="doc-info-block">
              <h1>{type}</h1>
              <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '400px', fontSize: '13px' }}>
                <div style={{ width: '45%' }}>
                  <div style={{ paddingBottom: '4px' }}>{type} Nr.</div>
                  <div>{data.Nummer}</div>
                </div>
                {type === "Lieferschein" && (
                  <div style={{ width: '25%' }}>
                    <div style={{ paddingBottom: '4px' }}>Lieferdatum</div>
                    <div>{datum}</div>
                  </div>
                )}
                <div style={{ width: '30%' }}>
                  <div style={{ paddingBottom: '4px' }}>Datum</div>
                  <div>{datum}</div>
                </div>
              </div>
            </div>

            <div className="doc-intro">
              <div className="doc-divider"></div>
              {type === "Lieferschein" ? (
                <div>Wir liefern Ihnen, wie vereinbart folgende Artikel:</div>
              ) : (
                <div>Für die verkauften Artikel stellen wir Ihnen folgende Positionen in Rechnung:</div>
              )}
            </div>

            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{width: '12%'}}>Artikelnr.</th>
                  <th style={{width: '18%'}}>Kategorie</th>
                  <th style={{width: '40%'}}>Bezeichnung</th>
                  <th style={{width: '10%'}}>Menge</th>
                  <th style={{width: '10%', textAlign: 'right'}}>Einzelpreis</th>
                  <th style={{width: '10%', textAlign: 'right'}}>Gesamtpreis</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const ep = Number(item.Verkaufspreis) || 0;
                  const gp = ep * item.menge;
                  const bezeichnung = getBezeichnung(item, item.artNrBasis);
                  return (
                    <tr key={idx}>
                      <td>{item.artNrBasis}</td>
                      <td>{getMaterialName(item.artNrBasis) || item.Art}</td>
                      <td>{bezeichnung}</td>
                      <td style={{textAlign: 'center'}}>{item.menge}</td>
                      <td style={{textAlign: 'right'}}>{ep.toFixed(2)} €</td>
                      <td style={{textAlign: 'right'}}>{gp.toFixed(2)} €</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {type === "Rechnung" && (
              <div className="doc-totals-box">
                <table className="totals-table">
                  <tbody>
                    <tr>
                      <td className="total-label" style={{ fontWeight: 'bold' }}>Gesamtwert</td>
                      <td colSpan="2" style={{ textAlign: 'right' }}>{totalBrutto.toFixed(2)} €</td>
                    </tr>
                    {provisionPercent > 0 && (
                      <tr>
                        <td className="total-label bold" style={{ textAlign: 'right' }}>- Provision</td>
                        <td className="bold" style={{ width: '50px', textAlign: 'left', paddingLeft: '8px' }}>{provisionPercent} %</td>
                        <td style={{ textAlign: 'right' }}>{provisionValue.toFixed(2)} €</td>
                      </tr>
                    )}
                    <tr className="totals-final">
                      <td colSpan="2" className="bold bg-gray">Überweisungsbetrag</td>
                      <td className="bg-gray" style={{ textAlign: 'right', borderBottom: '3px double #000' }}>{finalTotal.toFixed(2)} €</td>
                    </tr>
                  </tbody>
                </table>

                <div className="doc-footer-text">
                  <div>Gemäß § 19 Abs. 1 UStG wird keine Umsatzsteuer ausgewiesen.</div>
                  <div>Bitte überweisen Sie den Rechnungsbetrag an u.g. Bankverbindung.</div>
                  <div>Die Rechnung ist sofort bei Erhalt fällig.</div>
                  <div style={{ marginTop: '16px' }}>Vielen Dank</div>
                </div>
              </div>
            )}

            {type === "Lieferschein" && (
              <div className="doc-footer-text" style={{ marginTop: '20px' }}>
                <div>Lieferung: Die Lieferung erfolgt frei Haus.</div>
                <div style={{ marginTop: '16px' }}>Bei Rückfragen stehen wir Ihnen gerne zu Verfügung unter goldregen.schmuckdesign@gmail.com</div>
              </div>
            )}

            <div className="doc-signature">
              <div>Mit freundlichen Grüßen</div>
              <div className="signature-line" style={{ marginTop: '50px', borderTop: '1px solid #ccc', width: '200px', paddingTop: '4px' }}>
                Marina Südholt
              </div>
            </div>

            <div className="doc-page-footer">
              <div className="footer-col">
                <strong>Marina Südholt</strong><br/>
                Herzogin-Ludmilla-Ring 5<br/>
                84085 Langquaid
              </div>
              <div className="footer-col text-center">
                0152 22731186<br/>
                goldregen.schmuckdesign@gmail.com<br/>
                www.goldregenschmuckdesign.de
              </div>
              <div className="footer-col text-right">
                UniCredit Bank AG<br/>
                DE51 7502 0073 0029 2620 20<br/>
                HYVEDEMM447
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
