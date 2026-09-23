// @ts-check
// Schmuckstück query filters: Verkauft (1,¬Ausschuss), Ausschuss (1), Verfügbar (0,0,0)

/** @typedef {string|number|string[]} SqlParam */

class WhereClauseBuilder {
  /**
   * @param {number} [startParamIdx=1] Start-Index für Parameter ($1, $2, ...)
   * @param {{alias?: string}} [opts={}] alias qualifiziert die Spalten, z. B.
   *   alias: 's' ergibt s."Verkauft". Ohne alias bleibt es bei "Verkauft".
   */
  constructor(startParamIdx = 1, opts = {}) {
    /** @type {string[]} */
    this.conditions = [];
    /** @type {SqlParam[]} */
    this.params = [];
    this.paramIdx = startParamIdx;
    this.alias = opts.alias || null;
  }

  // Ohne Alias-Unterstützung konnten Abfragen mit Tabellenalias (inventur.js,
  // dashboard.js schreiben s."Verkauft") den Builder gar nicht nutzen und haben
  // ihre WHERE-Klauseln von Hand gebaut -- genau die Dublette aus Befund F5.
  /**
   * @param {string} name
   * @returns {string}
   */
  _col(name) {
    return this.alias ? `${this.alias}."${name}"` : `"${name}"`;
  }

  /** @returns {this} */
  verkauft() {
    this.conditions.push(`${this._col('Verkauft')} = 1 AND ${this._col('Ausschuss')} = 0`);
    return this;
  }

  /** @returns {this} */
  nichtVerkauft() {
    this.conditions.push(`${this._col('Verkauft')} = 0`);
    return this;
  }

  /** @returns {this} */
  ausschuss() {
    this.conditions.push(`${this._col('Ausschuss')} = 1`);
    return this;
  }

  /** @returns {this} */
  keinAusschuss() {
    this.conditions.push(`${this._col('Ausschuss')} = 0`);
    return this;
  }

  /** @returns {this} */
  verfuegbar() {
    this.conditions.push(
      `${this._col('Verkauft')} = 0 AND ${this._col('Ausschuss')} = 0 AND ${this._col('Ausgelagert')} = 0`,
    );
    return this;
  }

  /**
   * @param {number|null} [kundeId=null]
   * @returns {this}
   */
  ausgelagert(kundeId = null) {
    if (kundeId !== null) {
      this.conditions.push(`${this._col('Ausgelagert')} = $${this.paramIdx}`);
      this.params.push(kundeId);
      this.paramIdx++;
    } else {
      this.conditions.push(`${this._col('Ausgelagert')} > 0`);
    }
    return this;
  }

  /**
   * @param {number|null} [kundeId=null]
   * @returns {this}
   */
  aktivAusgelagert(kundeId = null) {
    if (kundeId !== null) {
      this.conditions.push(
        `${this._col('Ausgelagert')} = $${this.paramIdx}` +
          ` AND ${this._col('Verkauft')} = 0 AND ${this._col('Ausschuss')} = 0`,
      );
      this.params.push(kundeId);
      this.paramIdx++;
    } else {
      this.conditions.push(
        `${this._col('Ausgelagert')} > 0 AND ${this._col('Verkauft')} = 0 AND ${this._col('Ausschuss')} = 0`,
      );
    }
    return this;
  }

  /** @returns {this} */
  imLager() {
    this.conditions.push(`${this._col('Ausgelagert')} = 0`);
    return this;
  }

  /**
   * @param {number|null} [lieferscheinId=null]
   * @returns {this}
   */
  mitLieferschein(lieferscheinId = null) {
    if (lieferscheinId !== null) {
      this.conditions.push(`${this._col('Lieferschein_ID')} = $${this.paramIdx}`);
      this.params.push(lieferscheinId);
      this.paramIdx++;
    } else {
      this.conditions.push(`${this._col('Lieferschein_ID')} > 0`);
    }
    return this;
  }

  /**
   * @param {number|null} [rechnungId=null]
   * @returns {this}
   */
  mitRechnung(rechnungId = null) {
    if (rechnungId !== null) {
      this.conditions.push(`${this._col('Rechnung_ID')} = $${this.paramIdx}`);
      this.params.push(rechnungId);
      this.paramIdx++;
    } else {
      this.conditions.push(`${this._col('Rechnung_ID')} > 0`);
    }
    return this;
  }

  /** @returns {this} */
  ohneLieferschein() {
    this.conditions.push(`${this._col('Lieferschein_ID')} = 0`);
    return this;
  }

  /** @returns {this} */
  ohneRechnung() {
    this.conditions.push(`${this._col('Rechnung_ID')} = 0`);
    return this;
  }

  /**
   * @param {string} artikelnummer
   * @returns {this}
   */
  artikelnummer(artikelnummer) {
    this.conditions.push(`${this._col('Artikelnummer')} = $${this.paramIdx}`);
    this.params.push(artikelnummer);
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} pattern
   * @returns {this}
   */
  artikelnummerLike(pattern) {
    this.conditions.push(`${this._col('Artikelnummer')} LIKE $${this.paramIdx}`);
    this.params.push(pattern);
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string[]} artikelnummern
   * @returns {this}
   */
  artikelnummerIn(artikelnummern) {
    this.conditions.push(`${this._col('Artikelnummer')} = ANY($${this.paramIdx})`);
    this.params.push(artikelnummern);
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} buchstabe
   * @returns {this}
   */
  hersteller(buchstabe) {
    this.conditions.push(`SUBSTRING(${this._col('Artikelnummer')}, 1, 1) = $${this.paramIdx}`);
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} buchstabe
   * @returns {this}
   */
  grundmaterial(buchstabe) {
    this.conditions.push(`SUBSTRING(${this._col('Artikelnummer')}, 2, 1) = $${this.paramIdx}`);
    this.params.push(buchstabe.toUpperCase());
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} buchstabe
   * @returns {this}
   */
  produktart(buchstabe) {
    this.conditions.push(`SUBSTRING(${this._col('Artikelnummer')}, 3, 1) = $${this.paramIdx}`);
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
    this.conditions.push(`${this._col(spalte)} = $${this.paramIdx}`);
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
    this.conditions.push(`${this._col(spalte)} LIKE $${this.paramIdx}`);
    this.params.push(pattern);
    this.paramIdx++;
    return this;
  }

  /**
   * @param {string} spalte
   * @returns {this}
   */
  notEmpty(spalte) {
    this.conditions.push(`${this._col(spalte)} IS NOT NULL AND ${this._col(spalte)} != ''`);
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

  // build() und buildConditions() sind idempotent: sie lesen nur, sie
  // mutieren nicht. Das übliche Muster "ein Builder, zwei Queries" (Count +
  // Daten) ruft build() zweimal auf (Befund F1).
  /** @returns {string} */
  build() {
    if (this.conditions.length === 0) return "";
    return "WHERE " + this.conditions.join(" AND ");
  }

  /** @returns {string} */
  buildConditions() {
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
    const builder = new WhereClauseBuilder(this.paramIdx, { alias: this.alias || undefined });
    builder.conditions = [...this.conditions];
    builder.params = [...this.params];
    return builder;
  }
}

/**
 * Factory-Funktion für einfache Verwendung
 * @param {number} [startParamIdx=1] Start-Index für Parameter (default: 1)
 * @param {{alias?: string}} [opts={}] z. B. { alias: 's' } für s."Verkauft"
 * @returns {WhereClauseBuilder}
 */
function where(startParamIdx = 1, opts = {}) {
  return new WhereClauseBuilder(startParamIdx, opts);
}

module.exports = { WhereClauseBuilder, where };
