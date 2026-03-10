/**
 * WHERE Clause Builder für konsistente und sichere Datenbank-Queries
 *
 * Bietet Standard-Filter für Schmuckstücke mit klarer Geschäftslogik:
 * - Verkauft bedeutet IMMER: Verkauft = 1 UND Ausschuss = 0
 * - Ausschuss bedeutet IMMER: Ausschuss = 1 (unabhängig von Verkauft)
 * - Verfügbar bedeutet: Verkauft = 0 UND Ausschuss = 0 UND Ausgelagert = 0
 */

class WhereClauseBuilder {
  constructor(startParamIdx = 1, tenantId = null) {
    this.conditions = [];
    this.params = [];
    this.paramIdx = startParamIdx;
    this.tenantId = tenantId;
  }

  /**
   * Fügt automatisch tenant_id Bedingung hinzu wenn tenant_id gesetzt ist
   */
  _addTenantFilter() {
    if (this.tenantId !== null) {
      this.conditions.push(`"tenant_id" = $${this.paramIdx}`);
      this.params.push(this.tenantId);
      this.paramIdx++;
    }
  }

  /**
   * STANDARD-FILTER: Verkaufte Schmuckstücke
   * Regel: Verkauft = 1 UND Ausschuss = 0 (verkauft, aber NICHT Ausschuss)
   */
  verkauft() {
    this.conditions.push(`"Verkauft" = 1 AND "Ausschuss" = 0`);
    return this;
  }

  /**
   * STANDARD-FILTER: Nicht verkaufte Schmuckstücke
   * Regel: Verkauft = 0 (kann Ausschuss sein oder nicht)
   */
  nichtVerkauft() {
    this.conditions.push(`"Verkauft" = 0`);
    return this;
  }

  /**
   * STANDARD-FILTER: Ausschuss-Schmuckstücke
   * Regel: Ausschuss = 1 (unabhängig von Verkauft-Status)
   */
  ausschuss() {
    this.conditions.push(`"Ausschuss" = 1`);
    return this;
  }

  /**
   * STANDARD-FILTER: Kein Ausschuss
   * Regel: Ausschuss = 0
   */
  keinAusschuss() {
    this.conditions.push(`"Ausschuss" = 0`);
    return this;
  }

  /**
   * STANDARD-FILTER: Verfügbare Schmuckstücke (im Lager)
   * Regel: Verkauft = 0 UND Ausschuss = 0 UND Ausgelagert = 0
   */
  verfuegbar() {
    this.conditions.push(
      `"Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0`,
    );
    return this;
  }

  /**
   * STANDARD-FILTER: Ausgelagerte Schmuckstücke (bei Kunden)
   * Regel: Ausgelagert > 0
   */
  ausgelagert(kundeId = null) {
    if (kundeId !== null) {
      this.conditions.push(`"Ausgelagert" = $${this.paramIdx}`);
      this.params.push(kundeId);
      this.paramIdx++;
    } else {
      this.conditions.push(`"Ausgelagert" > 0`);
    }
    return this;
  }

  /**
   * STANDARD-FILTER: Aktiv ausgelagerte Schmuckstücke
   * Regel: Ausgelagert > 0 UND Verkauft = 0 UND Ausschuss = 0
   * (Bei Kunde, aber noch nicht verkauft oder als Ausschuss markiert)
   */
  aktivAusgelagert(kundeId = null) {
    if (kundeId !== null) {
      this.conditions.push(
        `"Ausgelagert" = $${this.paramIdx} AND "Verkauft" = 0 AND "Ausschuss" = 0`,
      );
      this.params.push(kundeId);
      this.paramIdx++;
    } else {
      this.conditions.push(
        `"Ausgelagert" > 0 AND "Verkauft" = 0 AND "Ausschuss" = 0`,
      );
    }
    return this;
  }

  /**
   * STANDARD-FILTER: Im Lager (nicht ausgelagert)
   * Regel: Ausgelagert = 0
   */
  imLager() {
    this.conditions.push(`"Ausgelagert" = 0`);
    return this;
  }

  /**
   * FILTER: Mit Lieferschein verbunden
   */
  mitLieferschein(lieferscheinId = null) {
    if (lieferscheinId !== null) {
      this.conditions.push(`"Lieferschein_ID" = $${this.paramIdx}`);
      this.params.push(lieferscheinId);
      this.paramIdx++;
    } else {
      this.conditions.push(`"Lieferschein_ID" > 0`);
    }
    return this;
  }

  /**
   * FILTER: Mit Rechnung verbunden
   */
  mitRechnung(rechnungId = null) {
    if (rechnungId !== null) {
      this.conditions.push(`"Rechnung_ID" = $${this.paramIdx}`);
      this.params.push(rechnungId);
      this.paramIdx++;
    } else {
      this.conditions.push(`"Rechnung_ID" > 0`);
    }
    return this;
  }

  /**
   * FILTER: Ohne Lieferschein
   */
  ohneLieferschein() {
    this.conditions.push(`"Lieferschein_ID" = 0`);
    return this;
  }

  /**
   * FILTER: Ohne Rechnung
   */
  ohneRechnung() {
    this.conditions.push(`"Rechnung_ID" = 0`);
    return this;
  }

  /**
   * FILTER: Artikelnummer (exakt)
   */
  artikelnummer(artikelnummer) {
    this.conditions.push(`"Artikelnummer" = $${this.paramIdx}`);
    this.params.push(artikelnummer);
    this.paramIdx++;
    return this;
  }

  /**
   * FILTER: Artikelnummer LIKE (mit Wildcard)
   */
  artikelnummerLike(pattern) {
    this.conditions.push(`"Artikelnummer" LIKE $${this.paramIdx}`);
    this.params.push(pattern);
    this.paramIdx++;
    return this;
  }

  /**
   * FILTER: Artikelnummer IN (Array)
   */
  artikelnummerIn(artikelnummern) {
    this.conditions.push(`"Artikelnummer" = ANY($${this.paramIdx})`);
    this.params.push(artikelnummern);
    this.paramIdx++;
    return this;
  }

  /**
   * FILTER: Hersteller (erste Stelle der Artikelnummer)
   * z.B. 'M' = Marina, 'S' = Saskia
   */
  hersteller(buchstabe) {
    this.conditions.push(
      `SUBSTRING("Artikelnummer", 1, 1) = $${this.paramIdx}`,
    );
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  hersteller_Marina() {
    this.hersteller("M");
    return this;
  }

  hersteller_Saskia() {
    this.hersteller("S");
    return this;
  }

  /**
   * FILTER: Grundmaterial (zweite Stelle der Artikelnummer)
   * z.B. 'B' = Beton, 'P' = Perle
   */
  grundmaterial(buchstabe) {
    this.conditions.push(
      `SUBSTRING("Artikelnummer", 2, 1) = $${this.paramIdx}`,
    );
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  /**
   * FILTER: Produktart (dritte Stelle der Artikelnummer)
   * z.B. 'A' = Armband, 'H' = Halskette, 'O' = Ohrring
   */
  produktart(buchstabe) {
    this.conditions.push(
      `SUBSTRING("Artikelnummer", 3, 1) = $${this.paramIdx}`,
    );
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  /**
   * FILTER: Beliebige Spalte = Wert
   */
  equals(spalte, wert) {
    this.conditions.push(`"${spalte}" = $${this.paramIdx}`);
    this.params.push(wert);
    this.paramIdx++;
    return this;
  }

  /**
   * FILTER: Beliebige Spalte LIKE Wert
   */
  like(spalte, pattern) {
    this.conditions.push(`"${spalte}" LIKE $${this.paramIdx}`);
    this.params.push(pattern);
    this.paramIdx++;
    return this;
  }

  /**
   * FILTER: Beliebige Spalte IS NOT NULL AND != ''
   */
  notEmpty(spalte) {
    this.conditions.push(`"${spalte}" IS NOT NULL AND "${spalte}" != ''`);
    return this;
  }

  /**
   * FILTER: Raw SQL Bedingung (für komplexe Fälle)
   * VORSICHT: Benutzer-Input muss separat validiert werden!
   */
  raw(condition, ...paramValues) {
    this.conditions.push(condition);
    paramValues.forEach((val) => {
      this.params.push(val);
      this.paramIdx++;
    });
    return this;
  }

  /**
   * Generiert die WHERE-Clause mit AND-Verknüpfung
   * @returns {string} WHERE clause (mit "WHERE" Keyword wenn Bedingungen vorhanden)
   */
  build() {
    this._addTenantFilter();
    if (this.conditions.length === 0) {
      return "";
    }
    return "WHERE " + this.conditions.join(" AND ");
  }

  /**
   * Generiert nur die Bedingungen (ohne "WHERE" Keyword)
   * Nützlich für FILTER(WHERE ...) in Aggregationen
   * @returns {string} Bedingungen (leer wenn keine vorhanden)
   */
  buildConditions() {
    this._addTenantFilter();
    return this.conditions.join(" AND ");
  }

  /**
   * Gibt die Parameter zurück
   * @returns {Array} Parameter-Array
   */
  getParams() {
    return this.params;
  }

  /**
   * Gibt den nächsten Parameter-Index zurück
   * Nützlich wenn weitere Parameter nach dem Builder hinzugefügt werden
   * @returns {number} Nächster Parameter-Index
   */
  getNextParamIdx() {
    return this.paramIdx;
  }

  /**
   * Erstellt einen neuen Builder mit gleichem Kontext
   * @returns {WhereClauseBuilder}
   */
  clone() {
    const builder = new WhereClauseBuilder(this.paramIdx, this.tenantId);
    builder.conditions = [...this.conditions];
    builder.params = [...this.params];
    return builder;
  }
}

/**
 * Factory-Funktion für einfache Verwendung
 * @param {number} startParamIdx - Start-Index für Parameter (default: 1)
 * @param {number|null} tenantId - Tenant ID für Multi-Tenancy (default: null)
 * @returns {WhereClauseBuilder}
 */
function where(startParamIdx = 1, tenantId = null) {
  return new WhereClauseBuilder(startParamIdx, tenantId);
}

module.exports = { WhereClauseBuilder, where };
