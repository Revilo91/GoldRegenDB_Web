// Schmuckstück query filters: Verkauft (1,¬Ausschuss), Ausschuss (1), Verfügbar (0,0,0)
class WhereClauseBuilder {
  constructor(startParamIdx = 1, tenantId = null) {
    this.conditions = [];
    this.params = [];
    this.paramIdx = startParamIdx;
    this.tenantId = tenantId;
  }

  _addTenantFilter() {
    if (this.tenantId !== null) {
      this.conditions.push(`"tenant_id" = $${this.paramIdx}`);
      this.params.push(this.tenantId);
      this.paramIdx++;
    }
  }

  verkauft() {
    this.conditions.push(`"Verkauft" = 1 AND "Ausschuss" = 0`);
    return this;
  }

  nichtVerkauft() {
    this.conditions.push(`"Verkauft" = 0`);
    return this;
  }

  ausschuss() {
    this.conditions.push(`"Ausschuss" = 1`);
    return this;
  }

  keinAusschuss() {
    this.conditions.push(`"Ausschuss" = 0`);
    return this;
  }

  verfuegbar() {
    this.conditions.push(`"Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0`);
    return this;
  }

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

  aktivAusgelagert(kundeId = null) {
    if (kundeId !== null) {
      this.conditions.push(`"Ausgelagert" = $${this.paramIdx} AND "Verkauft" = 0 AND "Ausschuss" = 0`);
      this.params.push(kundeId);
      this.paramIdx++;
    } else {
      this.conditions.push(`"Ausgelagert" > 0 AND "Verkauft" = 0 AND "Ausschuss" = 0`);
    }
    return this;
  }

  imLager() {
    this.conditions.push(`"Ausgelagert" = 0`);
    return this;
  }

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

  ohneLieferschein() {
    this.conditions.push(`"Lieferschein_ID" = 0`);
    return this;
  }

  ohneRechnung() {
    this.conditions.push(`"Rechnung_ID" = 0`);
    return this;
  }

  artikelnummer(artikelnummer) {
    this.conditions.push(`"Artikelnummer" = $${this.paramIdx}`);
    this.params.push(artikelnummer);
    this.paramIdx++;
    return this;
  }

  artikelnummerLike(pattern) {
    this.conditions.push(`"Artikelnummer" LIKE $${this.paramIdx}`);
    this.params.push(pattern);
    this.paramIdx++;
    return this;
  }

  artikelnummerIn(artikelnummern) {
    this.conditions.push(`"Artikelnummer" = ANY($${this.paramIdx})`);
    this.params.push(artikelnummern);
    this.paramIdx++;
    return this;
  }

  hersteller(buchstabe) {
    this.conditions.push(`SUBSTRING("Artikelnummer", 1, 1) = $${this.paramIdx}`);
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  grundmaterial(buchstabe) {
    this.conditions.push(`SUBSTRING("Artikelnummer", 2, 1) = $${this.paramIdx}`);
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  produktart(buchstabe) {
    this.conditions.push(`SUBSTRING("Artikelnummer", 3, 1) = $${this.paramIdx}`);
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  equals(spalte, wert) {
    this.conditions.push(`"${spalte}" = $${this.paramIdx}`);
    this.params.push(wert);
    this.paramIdx++;
    return this;
  }

  like(spalte, pattern) {
    this.conditions.push(`"${spalte}" LIKE $${this.paramIdx}`);
    this.params.push(pattern);
    this.paramIdx++;
    return this;
  }

  notEmpty(spalte) {
    this.conditions.push(`"${spalte}" IS NOT NULL AND "${spalte}" != ''`);
    return this;
  }

  raw(condition, ...paramValues) {
    this.conditions.push(condition);
    paramValues.forEach((val) => {
      this.params.push(val);
      this.paramIdx++;
    });
    return this;
  }

  build() {
    this._addTenantFilter();
    if (this.conditions.length === 0) return "";
    return "WHERE " + this.conditions.join(" AND ");
  }

  buildConditions() {
    this._addTenantFilter();
    return this.conditions.join(" AND ");
  }

  getParams() {
    return this.params;
  }

  getNextParamIdx() {
    return this.paramIdx;
  }

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
