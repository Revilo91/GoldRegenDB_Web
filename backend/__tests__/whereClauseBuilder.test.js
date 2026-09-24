const { where } = require('../src/utils/whereClauseBuilder');

describe('WhereClauseBuilder', () => {
  describe('Standard-Filter', () => {
    test('verkauft() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.verkauft();

      expect(builder.build()).toBe('WHERE "Verkauft" IS TRUE AND "Ausschuss" IS FALSE');
      expect(builder.getParams()).toEqual([]);
    });

    test('ausschuss() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.ausschuss();

      expect(builder.build()).toBe('WHERE "Ausschuss" IS TRUE');
      expect(builder.getParams()).toEqual([]);
    });

    test('verfuegbar() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.verfuegbar();

      expect(builder.build()).toBe('WHERE "Verkauft" IS FALSE AND "Ausschuss" IS FALSE AND "Ausgelagert" = 0');
      expect(builder.getParams()).toEqual([]);
    });

    test('nichtVerkauft() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.nichtVerkauft();

      expect(builder.build()).toBe('WHERE "Verkauft" IS FALSE');
      expect(builder.getParams()).toEqual([]);
    });

    test('keinAusschuss() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.keinAusschuss();

      expect(builder.build()).toBe('WHERE "Ausschuss" IS FALSE');
      expect(builder.getParams()).toEqual([]);
    });
  });

  describe('Ausgelagert-Filter', () => {
    test('ausgelagert() ohne Parameter', () => {
      const builder = where();
      builder.ausgelagert();

      expect(builder.build()).toBe('WHERE "Ausgelagert" > 0');
      expect(builder.getParams()).toEqual([]);
    });

    test('ausgelagert(kundeId) mit Parameter', () => {
      const builder = where();
      builder.ausgelagert(5);

      expect(builder.build()).toBe('WHERE "Ausgelagert" = $1');
      expect(builder.getParams()).toEqual([5]);
    });

    test('aktivAusgelagert() ohne Parameter', () => {
      const builder = where();
      builder.aktivAusgelagert();

      expect(builder.build()).toBe('WHERE "Ausgelagert" > 0 AND "Verkauft" IS FALSE AND "Ausschuss" IS FALSE');
      expect(builder.getParams()).toEqual([]);
    });

    test('aktivAusgelagert(kundeId) mit Parameter', () => {
      const builder = where();
      builder.aktivAusgelagert(3);

      expect(builder.build()).toBe('WHERE "Ausgelagert" = $1 AND "Verkauft" IS FALSE AND "Ausschuss" IS FALSE');
      expect(builder.getParams()).toEqual([3]);
    });

    test('imLager() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.imLager();

      expect(builder.build()).toBe('WHERE "Ausgelagert" = 0');
      expect(builder.getParams()).toEqual([]);
    });
  });

  describe('Artikelnummer-Filter', () => {
    test('artikelnummer() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.artikelnummer('MBH001');

      expect(builder.build()).toBe('WHERE "Artikelnummer" = $1');
      expect(builder.getParams()).toEqual(['MBH001']);
    });

    test('artikelnummerLike() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.artikelnummerLike('MBH%');

      expect(builder.build()).toBe('WHERE "Artikelnummer" LIKE $1');
      expect(builder.getParams()).toEqual(['MBH%']);
    });

    test('artikelnummerIn() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.artikelnummerIn(['MBH001', 'MBH002', 'MBH003']);

      expect(builder.build()).toBe('WHERE "Artikelnummer" = ANY($1)');
      expect(builder.getParams()).toEqual([['MBH001', 'MBH002', 'MBH003']]);
    });
  });

  describe('Artikelnummer-Präfix-Filter', () => {
    test('hersteller() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.hersteller('M');

      expect(builder.build()).toBe('WHERE SUBSTRING("Artikelnummer", 1, 1) = $1');
      expect(builder.getParams()).toEqual(['M']);
    });

    test('grundmaterial() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.grundmaterial('B');

      expect(builder.build()).toBe('WHERE SUBSTRING("Artikelnummer", 2, 1) = $1');
      expect(builder.getParams()).toEqual(['B']);
    });

    test('produktart() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.produktart('H');

      expect(builder.build()).toBe('WHERE SUBSTRING("Artikelnummer", 3, 1) = $1');
      expect(builder.getParams()).toEqual(['H']);
    });

    test('grundmaterial() und produktart() konvertieren zu Großbuchstaben', () => {
      const builder = where();
      builder.grundmaterial('b');
      builder.produktart('h');

      expect(builder.getParams()).toEqual(['B', 'H']);
    });
  });

  describe('Generische Filter', () => {
    test('equals() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.equals('Verkauft', 1);

      expect(builder.build()).toBe('WHERE "Verkauft" = $1');
      expect(builder.getParams()).toEqual([1]);
    });

    test('like() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.like('Name', '%Perle%');

      expect(builder.build()).toBe('WHERE "Name" LIKE $1');
      expect(builder.getParams()).toEqual(['%Perle%']);
    });

    test('notEmpty() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.notEmpty('Farbe');

      expect(builder.build()).toBe('WHERE "Farbe" IS NOT NULL AND "Farbe" != \'\'');
      expect(builder.getParams()).toEqual([]);
    });
  });

  describe('Kombinierte Filter', () => {
    test('Mehrere Filter mit AND verknüpft', () => {
      const builder = where();
      builder.verfuegbar();
      builder.grundmaterial('P');
      builder.produktart('A');

      expect(builder.build()).toBe(
        'WHERE "Verkauft" IS FALSE AND "Ausschuss" IS FALSE AND "Ausgelagert" = 0 ' +
        'AND SUBSTRING("Artikelnummer", 2, 1) = $1 ' +
        'AND SUBSTRING("Artikelnummer", 3, 1) = $2'
      );
      expect(builder.getParams()).toEqual(['P', 'A']);
    });

    test('Verkauft und mit Rechnung', () => {
      const builder = where();
      builder.verkauft();
      builder.mitRechnung(123);

      expect(builder.build()).toBe('WHERE "Verkauft" IS TRUE AND "Ausschuss" IS FALSE AND "Rechnung_ID" = $1');
      expect(builder.getParams()).toEqual([123]);
    });

    test('Ausgelagert beim Kunden und noch nicht verkauft', () => {
      const builder = where();
      builder.aktivAusgelagert(5);
      builder.ohneRechnung();

      expect(builder.build()).toBe(
        'WHERE "Ausgelagert" = $1 AND "Verkauft" IS FALSE AND "Ausschuss" IS FALSE ' +
        'AND "Rechnung_ID" = 0'
      );
      expect(builder.getParams()).toEqual([5]);
    });
  });

  describe('Parameter-Index', () => {
    test('Korrekte Parameter-Indizes bei mehreren Filtern', () => {
      const builder = where(1);
      builder.ausgelagert(5);
      builder.artikelnummer('MBH001');
      builder.equals('Farbe', 'Rot');

      expect(builder.build()).toBe(
        'WHERE "Ausgelagert" = $1 AND "Artikelnummer" = $2 AND "Farbe" = $3'
      );
      expect(builder.getParams()).toEqual([5, 'MBH001', 'Rot']);
      expect(builder.getNextParamIdx()).toBe(4);
    });

    test('Start-Index wird korrekt verwendet', () => {
      const builder = where(5);
      builder.artikelnummer('MBH001');

      expect(builder.build()).toBe('WHERE "Artikelnummer" = $5');
      expect(builder.getParams()).toEqual(['MBH001']);
      expect(builder.getNextParamIdx()).toBe(6);
    });
  });

  describe('Leere WHERE-Clause', () => {
    test('Leerer Builder gibt leeren String zurück', () => {
      const builder = where();

      expect(builder.build()).toBe('');
      expect(builder.getParams()).toEqual([]);
    });
  });

  describe('buildConditions()', () => {
    test('buildConditions() gibt nur Bedingungen ohne WHERE zurück', () => {
      const builder = where();
      builder.verkauft();
      builder.ausgelagert(5);

      expect(builder.buildConditions()).toBe('"Verkauft" IS TRUE AND "Ausschuss" IS FALSE AND "Ausgelagert" = $1');
      expect(builder.getParams()).toEqual([5]);
    });

    test('buildConditions() bei leerem Builder', () => {
      const builder = where();

      expect(builder.buildConditions()).toBe('');
    });
  });

  describe('raw()', () => {
    test('raw() erlaubt benutzerdefinierte Bedingungen', () => {
      const builder = where();
      builder.verfuegbar();
      builder.raw('("Name" ILIKE $2 OR "Material" ILIKE $2)', '%Perle%');

      expect(builder.build()).toBe(
        'WHERE "Verkauft" IS FALSE AND "Ausschuss" IS FALSE AND "Ausgelagert" = 0 ' +
        'AND ("Name" ILIKE $2 OR "Material" ILIKE $2)'
      );
      expect(builder.getParams()).toEqual(['%Perle%']);
    });
  });

  // Befund F1: build() mutierte über _addTenantFilter() den Builder. Das
  // übliche Muster "ein Builder, zwei Queries" (Count + Daten) ruft build()
  // zweimal auf und bekam dann eine doppelte Bedingung mit verschobenen
  // $n-Nummern.
  describe('Idempotenz von build()', () => {
    test('zweimal build() liefert dasselbe Ergebnis', () => {
      const builder = where();
      builder.verfuegbar().artikelnummer('MHO001');

      const ersterAufruf = builder.build();
      const zweiterAufruf = builder.build();

      expect(zweiterAufruf).toBe(ersterAufruf);
      expect(builder.getParams()).toEqual(['MHO001']);
      expect(builder.getNextParamIdx()).toBe(2);
    });

    test('build() und buildConditions() gemischt bleiben stabil', () => {
      const builder = where();
      builder.verkauft();

      expect(builder.buildConditions()).toBe('"Verkauft" IS TRUE AND "Ausschuss" IS FALSE');
      expect(builder.build()).toBe('WHERE "Verkauft" IS TRUE AND "Ausschuss" IS FALSE');
      expect(builder.buildConditions()).toBe('"Verkauft" IS TRUE AND "Ausschuss" IS FALSE');
      expect(builder.getParams()).toEqual([]);
    });
  });

  // Befund F5: Abfragen mit Tabellenalias (inventur.js, dashboard.js schreiben
  // s."Verkauft") konnten den Builder gar nicht nutzen und haben ihre
  // WHERE-Klauseln von Hand gebaut -- genau die Dublette, die der Builder
  // verhindern soll.
  describe('Tabellenalias', () => {
    test('alias qualifiziert alle Spalten', () => {
      expect(where(1, { alias: 's' }).verfuegbar().build())
        .toBe('WHERE s."Verkauft" IS FALSE AND s."Ausschuss" IS FALSE AND s."Ausgelagert" = 0');
    });

    test('ohne alias bleibt die Ausgabe unverändert', () => {
      expect(where().verfuegbar().build())
        .toBe('WHERE "Verkauft" IS FALSE AND "Ausschuss" IS FALSE AND "Ausgelagert" = 0');
    });

    test('alias gilt auch für Bedingungen mit Parameter', () => {
      const builder = where(1, { alias: 's' }).ausgelagert(7);

      expect(builder.build()).toBe('WHERE s."Ausgelagert" = $1');
      expect(builder.getParams()).toEqual([7]);
    });

    test('alias gilt für SUBSTRING-Filter und equals()', () => {
      expect(where(1, { alias: 's' }).hersteller('m').buildConditions())
        .toBe('SUBSTRING(s."Artikelnummer", 1, 1) = $1');
      expect(where(1, { alias: 'k' }).equals('Aktiv', true).buildConditions())
        .toBe('k."Aktiv" = $1');
    });

    test('clone() übernimmt den alias', () => {
      const builder = where(1, { alias: 's' }).verkauft().clone();

      expect(builder.artikelnummer('MHO001').build())
        .toBe('WHERE s."Verkauft" IS TRUE AND s."Ausschuss" IS FALSE AND s."Artikelnummer" = $1');
    });
  });

  describe('clone()', () => {
    test('clone() erstellt unabhängige Kopie', () => {
      const builder1 = where();
      builder1.verfuegbar();

      const builder2 = builder1.clone();
      builder2.grundmaterial('P');

      expect(builder1.build()).toBe('WHERE "Verkauft" IS FALSE AND "Ausschuss" IS FALSE AND "Ausgelagert" = 0');
      expect(builder2.build()).toBe(
        'WHERE "Verkauft" IS FALSE AND "Ausschuss" IS FALSE AND "Ausgelagert" = 0 ' +
        'AND SUBSTRING("Artikelnummer", 2, 1) = $1'
      );
    });
  });

  describe('Grenzfälle / Äquivalenzklassen', () => {
    test('equals() mit null als Wert übernimmt null unverändert in die Parameter', () => {
      const builder = where();
      builder.equals('Farbe', null);

      expect(builder.build()).toBe('WHERE "Farbe" = $1');
      expect(builder.getParams()).toEqual([null]);
    });

    test('equals() mit undefined als Wert übernimmt undefined unverändert in die Parameter', () => {
      const builder = where();
      builder.equals('Farbe', undefined);

      expect(builder.build()).toBe('WHERE "Farbe" = $1');
      expect(builder.getParams()).toEqual([undefined]);
    });

    test('equals() mit leerem String als Wert erzeugt Parameter mit leerem String (kein NULL-Vergleich)', () => {
      const builder = where();
      builder.equals('Farbe', '');

      expect(builder.build()).toBe('WHERE "Farbe" = $1');
      expect(builder.getParams()).toEqual(['']);
    });

    test('like() mit % im Muster übernimmt das Zeichen ungeprüft in den Parameter', () => {
      const builder = where();
      builder.like('Name', '%');

      expect(builder.build()).toBe('WHERE "Name" LIKE $1');
      expect(builder.getParams()).toEqual(['%']);
    });

    test('like() mit _ im Muster übernimmt das Zeichen ungeprüft in den Parameter', () => {
      const builder = where();
      builder.like('Name', 'M_H%');

      expect(builder.build()).toBe('WHERE "Name" LIKE $1');
      expect(builder.getParams()).toEqual(['M_H%']);
    });

    test('like() escaped Wildcards nicht – Muster wird 1:1 als Parameter durchgereicht', () => {
      // Dokumentiert das tatsächliche Verhalten: keine Escaping-Logik im Builder,
      // die Verantwortung liegt beim Aufrufer (kein SQL-Injection-Risiko, da parametrisiert)
      const builder = where();
      builder.like('Artikelnummer', "MBH'); DROP TABLE Schmuckstück;--%");

      expect(builder.build()).toBe('WHERE "Artikelnummer" LIKE $1');
      expect(builder.getParams()).toEqual(["MBH'); DROP TABLE Schmuckstück;--%"]);
    });

    test('artikelnummerIn([]) mit leerem Array erzeugt gültige Klausel ohne Absturz', () => {
      const builder = where();
      builder.artikelnummerIn([]);

      expect(builder.build()).toBe('WHERE "Artikelnummer" = ANY($1)');
      expect(builder.getParams()).toEqual([[]]);
    });
  });

  describe('Lieferschein/Rechnung-Filter', () => {
    test('mitLieferschein() ohne Parameter', () => {
      const builder = where();
      builder.mitLieferschein();

      expect(builder.build()).toBe('WHERE "Lieferschein_ID" > 0');
    });

    test('mitLieferschein(id) mit Parameter', () => {
      const builder = where();
      builder.mitLieferschein(123);

      expect(builder.build()).toBe('WHERE "Lieferschein_ID" = $1');
      expect(builder.getParams()).toEqual([123]);
    });

    test('ohneLieferschein() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.ohneLieferschein();

      expect(builder.build()).toBe('WHERE "Lieferschein_ID" = 0');
    });

    test('mitRechnung() ohne Parameter', () => {
      const builder = where();
      builder.mitRechnung();

      expect(builder.build()).toBe('WHERE "Rechnung_ID" > 0');
    });

    test('mitRechnung(id) mit Parameter', () => {
      const builder = where();
      builder.mitRechnung(456);

      expect(builder.build()).toBe('WHERE "Rechnung_ID" = $1');
      expect(builder.getParams()).toEqual([456]);
    });

    test('ohneRechnung() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.ohneRechnung();

      expect(builder.build()).toBe('WHERE "Rechnung_ID" = 0');
    });
  });
});
