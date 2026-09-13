// @ts-check
// Schmuckstück query filters: Verkauft (1,¬Ausschuss), Ausschuss (1), Verfügbar (0,0,0)

/** @typedef {string|number|string[]} SqlParam */

class WhereClauseBuilder {
  /**
   * @param {number} [startParamIdx=1] Start-Index für Parameter ($1, $2, ...)
   * @param {number|string|null} [tenantId=null] Tenant ID für Multi-Tenancy
   */
  constructor(startParamIdx = 1, tenantId = null) {
    /** @type {string[]} */
    this.conditions = [];
    /** @type {SqlParam[]} */
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

  /** @returns {this} */
  verkauft() {
    this.conditions.push(`"Verkauft" = 1 AND "Ausschuss" = 0`);
    return this;
  }

  /** @returns {this} */
  nichtVerkauft() {
    this.conditions.push(`"Verkauft" = 0`);
    return this;
  }

  /** @returns {this} */
  ausschuss() {
    this.conditions.push(`"Ausschuss" = 1`);
    return this;
  }

  /** @returns {this} */
  keinAusschuss() {
    this.conditions.push(`"Ausschuss" = 0`);
    return this;
  }

  /** @returns {this} */
  verfuegbar() {
    this.conditions.push(`"Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0`);
    return this;
  }

  /**
   * @param {number|null} [kundeId=null]
   * @returns {this}
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
   * @param {number|null} [kundeId=null]
   * @returns {this}
   */
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

  /** @returns {this} */
  imLager() {
    this.conditions.push(`"Ausgelagert" = 0`);
    return this;
  }

  /**
   * @param {number|null} [lieferscheinId=null]
   * @returns {this}
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
   * @param {number|null} [rechnungId=null]
   * @returns {this}
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

  /** @returns {this} */
  ohneLieferschein() {
    this.conditions.push(`"Lieferschein_ID" = 0`);
    return this;
  }

  /** @returns {this} */
  ohneRechnung() {
    this.conditions.push(`"Rechnung_ID" = 0`);
    return this;
  }

  /**
   * @param {string} artikelnummer
   * @returns {this}
   */
  artikelnummer(artikelnummer) {
    this.conditions.push(`"Artikelnummer" = $${this.paramIdx}`);
    this.params.push(artikelnummer);
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} pattern
   * @returns {this}
   */
  artikelnummerLike(pattern) {
    this.conditions.push(`"Artikelnummer" LIKE $${this.paramIdx}`);
    this.params.push(pattern);
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string[]} artikelnummern
   * @returns {this}
   */
  artikelnummerIn(artikelnummern) {
    this.conditions.push(`"Artikelnummer" = ANY($${this.paramIdx})`);
    this.params.push(artikelnummern);
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} buchstabe
   * @returns {this}
   */
  hersteller(buchstabe) {
    this.conditions.push(`SUBSTRING("Artikelnummer", 1, 1) = $${this.paramIdx}`);
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} buchstabe
   * @returns {this}
   */
  grundmaterial(buchstabe) {
    this.conditions.push(`SUBSTRING("Artikelnummer", 2, 1) = $${this.paramIdx}`);
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} buchstabe
   * @returns {this}
   */
  produktart(buchstabe) {
    this.conditions.push(`SUBSTRING("Artikelnummer", 3, 1) = $${this.paramIdx}`);
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} spalte
   * @param {SqlParam} wert
   * @returns {this}
   */
  equals(spalte, wert) {
    this.conditions.push(`"${spalte}" = $${this.paramIdx}`);
    this.params.push(wert);
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} spalte
   * @param {string} pattern
   * @returns {this}
   */
  like(spalte, pattern) {
    this.conditions.push(`"${spalte}" LIKE $${this.paramIdx}`);
    this.params.push(pattern);
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} spalte
   * @returns {this}
   */
  notEmpty(spalte) {
    this.conditions.push(`"${spalte}" IS NOT NULL AND "${spalte}" != ''`);
    return this;
  }

  /**
   * @param {string} condition
   * @param {...SqlParam} paramValues
   * @returns {this}
   */
  raw(condition, ...paramValues) {
    this.conditions.push(condition);
    paramValues.forEach((val) => {
      this.params.push(val);
      this.paramIdx++;
    });
    return this;
  }

  /** @returns {string} */
  build() {
    this._addTenantFilter();
    if (this.conditions.length === 0) return "";
    return "WHERE " + this.conditions.join(" AND ");
  }

  /** @returns {string} */
  buildConditions() {
    this._addTenantFilter();
    return this.conditions.join(" AND ");
  }

  /** @returns {SqlParam[]} */
  getParams() {
    return this.params;
  }

  /** @returns {number} */
  getNextParamIdx() {
    return this.paramIdx;
  }

  /** @returns {WhereClauseBuilder} */
  clone() {
    const builder = new WhereClauseBuilder(this.paramIdx, this.tenantId);
    builder.conditions = [...this.conditions];
    builder.params = [...this.params];
    return builder;
  }
}

/**
 * Factory-Funktion für einfache Verwendung
 * @param {number} [startParamIdx=1] Start-Index für Parameter (default: 1)
 * @param {number|string|null} [tenantId=null] Tenant ID für Multi-Tenancy (default: null)
 * @returns {WhereClauseBuilder}
 */
function where(startParamIdx = 1, tenantId = null) {
  return new WhereClauseBuilder(startParamIdx, tenantId);
}

module.exports = { WhereClauseBuilder, where };
