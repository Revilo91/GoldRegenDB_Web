#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { readOnlyQuery } = require('./db');

// Nur lesende Statements erlaubt. Zusätzlich läuft jede Query serverseitig
// in einer READ ONLY-Transaktion (siehe db.js) als zweite Verteidigungslinie.
const ALLOWED_STATEMENT = /^\s*(SELECT|WITH|EXPLAIN|SHOW)\b/i;
const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|CALL|VACUUM|COPY)\b/i;

function assertReadOnly(sql) {
  if (!ALLOWED_STATEMENT.test(sql)) {
    throw new Error('Nur SELECT/WITH/EXPLAIN/SHOW-Statements sind erlaubt.');
  }
  if (FORBIDDEN_KEYWORDS.test(sql)) {
    throw new Error('Schreib- oder Schema-Änderungen sind nicht erlaubt.');
  }
  if (sql.includes(';') && sql.trim().indexOf(';') !== sql.trim().length - 1) {
    throw new Error('Mehrere Statements in einer Query sind nicht erlaubt.');
  }
}

const server = new Server(
  { name: 'goldregendb-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: 'list_tables',
    description: 'Listet alle Tabellen im public-Schema der GoldRegenDB-Datenbank.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'describe_table',
    description: 'Zeigt Spalten, Typen und Constraints einer Tabelle.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string', description: 'Tabellenname, z.B. "Schmuckstück"' } },
      required: ['table'],
      additionalProperties: false,
    },
  },
  {
    name: 'query',
    description:
      'Führt eine schreibgeschützte SQL-Abfrage aus (nur SELECT/WITH/EXPLAIN/SHOW). ' +
      'Keine INSERT/UPDATE/DELETE/DDL-Statements möglich.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT-Statement' },
        params: {
          type: 'array',
          items: {},
          description: 'Optionale Parameter für $1, $2, ... Platzhalter',
        },
        limit: {
          type: 'number',
          description: 'Max. Anzahl Zeilen (Default 200, Max 1000)',
        },
      },
      required: ['sql'],
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    if (name === 'list_tables') {
      const result = await readOnlyQuery(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name`
      );
      return toResult(result.rows.map((r) => r.table_name));
    }

    if (name === 'describe_table') {
      const result = await readOnlyQuery(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [args.table]
      );
      if (result.rows.length === 0) {
        throw new Error(`Tabelle "${args.table}" existiert nicht.`);
      }
      return toResult(result.rows);
    }

    if (name === 'query') {
      assertReadOnly(args.sql);
      const limit = Math.min(Math.max(Number(args.limit) || 200, 1), 1000);
      const wrapped = `SELECT * FROM (${args.sql.trim().replace(/;\s*$/, '')}) AS _sub LIMIT ${limit}`;
      const result = await readOnlyQuery(wrapped, args.params || []);
      return toResult(result.rows);
    }

    throw new Error(`Unbekanntes Tool: ${name}`);
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Fehler: ${err.message}` }],
      isError: true,
    };
  }
});

function toResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP-Server konnte nicht gestartet werden:', err);
  process.exit(1);
});
