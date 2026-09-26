const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const { version } = require('../../package.json');

// OpenAPI-Grundgerüst + Doku-Quelle sind die @swagger-JSDoc-Blöcke über den
// Route-Handlern in src/routes/*.js. Schemas hier bilden reale Spalten aus
// db/init.sql bzw. src/types/db.d.ts ab, keine erfundenen Beispiele.
const definition = {
  openapi: '3.0.3',
  info: {
    title: 'GoldRegenDB API',
    version,
    description: 'Warenwirtschaft für handgefertigten Schmuck – REST-API des Node/Express-Backends.',
  },
  servers: [{ url: '/api' }],
  // Standard für alle Operationen ohne eigenen security-Block: Cookie- oder
  // Bearer-Auth genügt. Zustandsändernde Routen (POST/PUT/PATCH/DELETE) hinter
  // Cookie-Auth überschreiben das in ihrem @swagger-Block zusätzlich mit
  // csrfHeader (siehe middleware/csrf.js) – ohne den Header schlägt "Try it
  // out" dort mit 403 CSRF_TOKEN_INVALID fehl.
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  components: {
    securitySchemes: {
      // Standardfall: httpOnly-Cookie, das der Browser automatisch mitschickt
      // (api.js nutzt credentials: 'include'). "Try it out" in der Swagger-UI
      // funktioniert damit nur, wenn im selben Browser bereits ein Login über
      // die echte Anwendung stattgefunden hat – das Cookie ist httpOnly und
      // daher hier nicht über ein Eingabefeld setzbar.
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'jwt',
        description: 'httpOnly-JWT-Cookie, gesetzt von POST /api/auth/login. Primärer Auth-Weg des Frontends.',
      },
      // Fallback für Skripte/E2E-Tests (siehe CLAUDE.md, "Authentication Flow").
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Authorization: Bearer <token> – nur für Skripte/E2E-Tests, nicht der Standardweg.',
      },
      // Kein echtes Auth-Schema, sondern die Pflicht-Gegenstelle zum
      // csrfToken-Cookie beim Double-Submit-Pattern (middleware/csrf.js).
      // Nur bei Cookie-Auth + POST/PUT/PATCH/DELETE nötig, siehe Route-Doku.
      csrfHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description:
          'Nur bei Cookie-Auth für POST/PUT/PATCH/DELETE erforderlich (Double-Submit-Cookie, '
          + 'siehe GET /api/csrf-token). Bearer-Token-Clients sind ausgenommen.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Fehlermeldung' } },
      },
      ValidationError: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Name: darf nicht leer sein' },
          details: { type: 'array', items: { type: 'object' } },
        },
      },
      Kunde: {
        type: 'object',
        properties: {
          ID: { type: 'integer', example: 12 },
          Name: { type: 'string', example: 'Beispiel-Laden' },
          Strasse: { type: 'string', example: 'Musterweg' },
          Hausnummer: { type: 'string', example: '12a' },
          Ort: { type: 'string', example: 'Musterstadt' },
          PLZ: { type: 'integer', example: 12345 },
          Email: { type: 'string', nullable: true, example: 'kontakt@beispiel.invalid' },
          Telefonnummer: { type: 'string', nullable: true },
          Provision: { type: 'integer', minimum: 0, maximum: 100, example: 20 },
          Aktiv: { type: 'boolean' },
          Land: { type: 'string', example: 'DE', description: 'ISO 3166-1 Alpha-2 (E-Rechnung BT-55)' },
          UStIdNr: { type: 'string', nullable: true, example: 'DE123456789', description: 'E-Rechnung BT-48' },
          Leitweg_ID: {
            type: 'string', nullable: true,
            description: 'E-Rechnung BT-10 (Käuferreferenz); ohne Angabe wird die Kundennummer verwendet',
          },
        },
      },
      Schmuckstueck: {
        type: 'object',
        description: 'Kein eigenes "verfuegbar"-Feld – der Status ergibt sich aus Verkauft/Ausschuss/Ausgelagert '
          + '(siehe CLAUDE.md, WHERE Clause Builder).',
        properties: {
          Artikelnummer: { type: 'string', example: 'MHO123_1' },
          Name: { type: 'string', nullable: true },
          hatFoto: { type: 'boolean', description: 'Es gibt ein Foto zur Basis-Artikelnummer (nur lesend)' },
          Art: { type: 'string', nullable: true },
          Form: { type: 'string', nullable: true },
          Länge: { type: 'number', nullable: true },
          Fassung: { type: 'string', nullable: true },
          Farbe: { type: 'string', nullable: true },
          Material: { type: 'string', nullable: true },
          Grösse: { type: 'number', nullable: true },
          Herstellungskosten: {
            type: 'string', description: 'NUMERIC(10,2), von pg als String geliefert', example: '19.99',
          },
          Verkaufspreis: {
            type: 'string', description: 'NUMERIC(10,2), von pg als String geliefert', example: '24.50',
          },
          Ausgelagert: { type: 'integer', description: '0 = im Lager, sonst Kunde.ID', example: 0 },
          Verkauft: { type: 'boolean' },
          Ausschuss: { type: 'boolean' },
          Ausschuss_Grund: { type: 'string', nullable: true },
          Lieferschein_ID: { type: 'integer', description: '0 = keinem Lieferschein zugeordnet' },
          Rechnung_ID: { type: 'integer', description: '0 = keiner Rechnung zugeordnet' },
          Erstelldatum: { type: 'string', format: 'date-time' },
          Letzte_Änderung: { type: 'string', format: 'date-time' },
        },
      },
      Lieferschein: {
        type: 'object',
        properties: {
          ID: { type: 'integer' },
          Nummer: { type: 'string', example: 'LS-2026-0001' },
          Kundennummer: { type: 'integer' },
          Datum: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['entwurf', 'final'] },
        },
      },
      Rechnung: {
        type: 'object',
        properties: {
          ID: { type: 'integer' },
          Nummer: { type: 'string', example: 'RE-2026-0001' },
          Kundennummer: { type: 'integer' },
          Datum: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['entwurf', 'final'] },
          rabatt_gesamt: { type: 'string', description: 'NUMERIC(5,2), von pg als String geliefert', example: '10.00' },
          rabatt_positionen: {
            type: 'object',
            description: 'Rabatt je Artikelnummer in Prozent',
            additionalProperties: { type: 'number' },
            example: { MHO123_1: 10 },
          },
        },
      },
      AppUser: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          username: { type: 'string', example: 'bearbeiter1' },
          email: { type: 'string', nullable: true },
          role: { type: 'string', enum: ['admin', 'bearbeiter', 'user'] },
          active: { type: 'boolean' },
          must_change_password: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          last_login: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      AuditLogEintrag: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          table_name: { type: 'string', example: 'Schmuckstück' },
          artikelnummer_id: { type: 'string', nullable: true },
          column_name: { type: 'string', nullable: true },
          old_value: { type: 'string', nullable: true },
          new_value: { type: 'string', nullable: true },
          action_type: { type: 'string', enum: ['INSERT', 'UPDATE', 'DELETE'] },
          changed_by: { type: 'string', nullable: true },
          change_timestamp: { type: 'string', format: 'date-time' },
        },
      },
      LagerinventurEntwurf: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          user_id: { type: 'integer' },
          status: { type: 'string', enum: ['entwurf', 'abgeschlossen'] },
          data: {
            type: 'object',
            description: 'Gezählte Menge je Artikelnummer',
            additionalProperties: { type: 'integer' },
            example: { MHO123_1: 3 },
          },
          kommentar: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Bestellung: {
        type: 'object',
        description: 'Personenbezogene Kundenfelder sind AES-256-GCM-verschlüsselt gespeichert und werden in '
          + 'der API-Antwort entschlüsselt zurückgegeben (außer bei anonymisierten Bestellungen).',
        properties: {
          id: { type: 'integer' },
          bestellnummer: { type: 'string', example: 'B-2026-0001' },
          versandart: { type: 'string', enum: ['abholung', 'lieferung'] },
          erfassungsdatum: { type: 'string', format: 'date-time' },
          wunschdatum: { type: 'string', format: 'date', nullable: true },
          beschreibung: { type: 'string' },
          status: { type: 'string', enum: ['offen', 'in_bearbeitung', 'abgeschlossen', 'storniert'] },
          rechnung_nummer: { type: 'string', nullable: true },
          foto_pfad: { type: 'string', nullable: true, description: 'Schlüssel des Referenzfotos in bestellung_foto, abrufbar über GET /bestelluebersicht/foto/:fileName' },
          kunde: {
            type: 'object',
            properties: {
              kundeId: { type: 'integer' },
              kundePseudonym: { type: 'string' },
              anonymisiert: { type: 'boolean' },
              name: { type: 'string', nullable: true },
              email: { type: 'string', nullable: true },
              telefonnummer: { type: 'string', nullable: true },
              strasse: { type: 'string', nullable: true },
              hausnummer: { type: 'string', nullable: true },
              plz: { type: 'string', nullable: true },
              ort: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
    responses: {
      ValidationError: {
        description: 'Zod-Validierung fehlgeschlagen',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
      },
      Unauthorized: {
        description: 'Kein/ungültiges JWT (Cookie oder Bearer-Header)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Rolle reicht nicht aus, oder CSRF-Token fehlt/ist ungültig',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'Ressource nicht gefunden',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      ServerError: {
        description: 'Interner Serverfehler',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
};

const swaggerSpec = swaggerJsdoc({
  definition,
  apis: [path.join(__dirname, '..', 'routes', '*.js')],
});

// Einzige Quelle für die /api-docs-Freigabe-Entscheidung, damit index.js und
// der Test in __tests__/swagger.test.js nicht auseinanderlaufen können.
// Standardmäßig nur außerhalb von Produktion aktiv; ENABLE_API_DOCS erlaubt
// eine explizite Übersteuerung (z. B. Staging mit NODE_ENV=production).
function shouldEnableApiDocs(env = process.env) {
  if (env.ENABLE_API_DOCS === undefined) {
    return env.NODE_ENV !== 'production';
  }
  return env.ENABLE_API_DOCS === 'true';
}

module.exports = swaggerSpec;
module.exports.shouldEnableApiDocs = shouldEnableApiDocs;
