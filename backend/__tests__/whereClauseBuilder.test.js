const { where } = require('../src/utils/whereClauseBuilder');

describe('WhereClauseBuilder', () => {
  describe('Standard-Filter', () => {
    test('verkauft() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.verkauft();

      expect(builder.build()).toBe('WHERE "Verkauft" = 1 AND "Ausschuss" = 0');
      expect(builder.getParams()).toEqual([]);
    });

    test('ausschuss() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.ausschuss();

      expect(builder.build()).toBe('WHERE "Ausschuss" = 1');
      expect(builder.getParams()).toEqual([]);
    });

    test('verfuegbar() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.verfuegbar();

      expect(builder.build()).toBe('WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0');
      expect(builder.getParams()).toEqual([]);
    });

    test('nichtVerkauft() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.nichtVerkauft();

      expect(builder.build()).toBe('WHERE "Verkauft" = 0');
      expect(builder.getParams()).toEqual([]);
    });

    test('keinAusschuss() erstellt korrekte WHERE-Clause', () => {
      const builder = where();
      builder.keinAusschuss();

      expect(builder.build()).toBe('WHERE "Ausschuss" = 0');
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

      expect(builder.build()).toBe('WHERE "Ausgelagert" > 0 AND "Verkauft" = 0 AND "Ausschuss" = 0');
      expect(builder.getParams()).toEqual([]);
    });

    test('aktivAusgelagert(kundeId) mit Parameter', () => {
      const builder = where();
      builder.aktivAusgelagert(3);

      expect(builder.build()).toBe('WHERE "Ausgelagert" = $1 AND "Verkauft" = 0 AND "Ausschuss" = 0');
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
        'WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0 ' +
        'AND SUBSTRING("Artikelnummer", 2, 1) = $1 ' +
        'AND SUBSTRING("Artikelnummer", 3, 1) = $2'
      );
      expect(builder.getParams()).toEqual(['P', 'A']);
    });

    test('Verkauft und mit Rechnung', () => {
      const builder = where();
      builder.verkauft();
      builder.mitRechnung(123);

      expect(builder.build()).toBe('WHERE "Verkauft" = 1 AND "Ausschuss" = 0 AND "Rechnung_ID" = $1');
      expect(builder.getParams()).toEqual([123]);
    });

    test('Ausgelagert beim Kunden und noch nicht verkauft', () => {
      const builder = where();
      builder.aktivAusgelagert(5);
      builder.ohneRechnung();

      expect(builder.build()).toBe(
        'WHERE "Ausgelagert" = $1 AND "Verkauft" = 0 AND "Ausschuss" = 0 ' +
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

      expect(builder.buildConditions()).toBe('"Verkauft" = 1 AND "Ausschuss" = 0 AND "Ausgelagert" = $1');
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
        'WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0 ' +
        'AND ("Name" ILIKE $2 OR "Material" ILIKE $2)'
      );
      expect(builder.getParams()).toEqual(['%Perle%']);
    });
  });

  describe('Multi-Tenancy', () => {
    test('tenant_id wird automatisch hinzugefügt', () => {
      const builder = where(1, 42);
      builder.verfuegbar();

      expect(builder.build()).toBe('WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0 AND "tenant_id" = $1');
      expect(builder.getParams()).toEqual([42]);
    });

    test('tenant_id = null fügt keine Bedingung hinzu', () => {
      const builder = where(1, null);
      builder.verfuegbar();

      expect(builder.build()).toBe('WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0');
      expect(builder.getParams()).toEqual([]);
    });
  });

  describe('clone()', () => {
    test('clone() erstellt unabhängige Kopie', () => {
      const builder1 = where();
      builder1.verfuegbar();

      const builder2 = builder1.clone();
      builder2.grundmaterial('P');

      expect(builder1.build()).toBe('WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0');
      expect(builder2.build()).toBe(
        'WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0 ' +
        'AND SUBSTRING("Artikelnummer", 2, 1) = $1'
      );
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
