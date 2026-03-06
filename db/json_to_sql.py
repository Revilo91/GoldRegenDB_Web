#!/usr/bin/env python3
"""Konvertiert GoldRegenDB-Backup-JSON in PostgreSQL-SQL.

Unterstützte Eingabeformate:
1) Standard-Backup: {"version": "...", "timestamp": "...", "tables": {...}}
2) Array-Export: [{"type": "header"}, {"type": "table", "name": "...", "data": [...]}, ...]
3) Direktes Tabellen-Dict: {"Kunde": [...], "Rechnung": [...], ...}
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


@dataclass
class ConversionStats:
    table_rows: dict[str, int]
    table_statements: dict[str, int]
    total_rows: int
    total_statements: int


def quote_identifier(name: str) -> str:
    escaped = name.replace('"', '""')
    return f'"{escaped}"'


def sql_string_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_value(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(value) if math.isfinite(value) else "NULL"
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"

    json_text = json.dumps(value, ensure_ascii=False)
    return "'" + json_text.replace("'", "''") + "'"


def detect_tables(
    payload: Any,
) -> tuple[dict[str, list[dict[str, Any]]], str, dict[str, Any]]:
    metadata: dict[str, Any] = {}

    if isinstance(payload, dict) and isinstance(payload.get("tables"), dict):
        metadata["version"] = payload.get("version")
        metadata["timestamp"] = payload.get("timestamp")
        return payload["tables"], "backup", metadata

    if isinstance(payload, list):
        tables: dict[str, list[dict[str, Any]]] = {}
        for item in payload:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type == "header":
                metadata["version"] = item.get("version")
                metadata["timestamp"] = item.get("timestamp")
                continue
            if item_type == "table":
                name = item.get("name")
                data = item.get("data")
                if isinstance(name, str) and isinstance(data, list):
                    tables[name] = data
        return tables, "array", metadata

    if isinstance(payload, dict):
        guessed_tables: dict[str, list[dict[str, Any]]] = {
            key: value for key, value in payload.items() if isinstance(value, list)
        }
        if guessed_tables:
            return guessed_tables, "direct", metadata

    raise ValueError(
        "Unbekanntes JSON-Format. Erwartet wird Backup-, Array- oder Tabellen-Dict-Format."
    )


def discover_columns(rows: list[dict[str, Any]]) -> list[str]:
    ordered = OrderedDict()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            ordered.setdefault(str(key), None)
    return list(ordered.keys())


def build_insert_statement(
    table_name: str,
    columns: list[str],
    rows: list[dict[str, Any]],
) -> str:
    quoted_table = quote_identifier(table_name)
    quoted_columns = ", ".join(quote_identifier(col) for col in columns)

    value_rows: list[str] = []
    for row in rows:
        values = ", ".join(sql_value(row.get(col)) for col in columns)
        value_rows.append(f"({values})")

    return (
        f"INSERT INTO {quoted_table} ({quoted_columns}) VALUES\n  "
        + ",\n  ".join(value_rows)
        + ";"
    )


def convert_tables_to_sql(
    tables: dict[str, list[dict[str, Any]]],
    batch_size: int,
    include_tables: set[str] | None,
    exclude_tables: set[str],
    include_header: bool,
    include_transaction: bool,
    truncate_first: bool,
    disable_triggers: bool,
    reset_sequences: bool,
) -> tuple[list[str], ConversionStats]:
    statements: list[str] = []
    table_rows: dict[str, int] = {}
    table_statements: dict[str, int] = {}
    total_rows = 0

    selected_tables = [
        table_name
        for table_name in tables.keys()
        if (include_tables is None or table_name in include_tables)
        and table_name not in exclude_tables
    ]

    if include_header:
        statements.append(
            f"-- GoldRegenDB SQL Export ({datetime.now().isoformat(timespec='seconds')})"
        )
        statements.append("-- Generiert aus JSON-Backup")

    if include_transaction:
        statements.append("BEGIN;")

    if truncate_first and selected_tables:
        quoted = ", ".join(quote_identifier(name) for name in selected_tables)
        statements.append(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE;")

    has_schmuckstueck = "Schmuckstück" in selected_tables
    if disable_triggers and has_schmuckstueck:
        statements.append("-- Disable triggers during bulk import")
        statements.append('ALTER TABLE "Schmuckstück" DISABLE TRIGGER ALL;')

    for table_name in selected_tables:
        rows_raw = tables.get(table_name, [])
        rows = [row for row in rows_raw if isinstance(row, dict)]

        if not rows:
            continue

        columns = discover_columns(rows)
        if not columns:
            continue

        table_rows[table_name] = len(rows)
        total_rows += len(rows)

        statements.append(f"-- Tabelle: {table_name} ({len(rows)} Zeilen)")

        created = 0
        for idx in range(0, len(rows), batch_size):
            batch = rows[idx : idx + batch_size]
            statements.append(build_insert_statement(table_name, columns, batch))
            created += 1

        table_statements[table_name] = created

    sequence_columns = {
        "Kunde": "ID",
        "Lieferschein": "ID",
        "Rechnung": "ID",
        "audit_log": "id",
        "app_users": "id",
    }
    if reset_sequences:
        sequence_statements: list[str] = []
        for table_name in selected_tables:
            column_name = sequence_columns.get(table_name)
            if not column_name:
                continue

            quoted_table = quote_identifier(table_name)
            quoted_column = quote_identifier(column_name)
            table_literal = sql_string_literal(quoted_table)
            column_literal = sql_string_literal(column_name)

            sequence_statements.append(
                "SELECT setval("
                f"pg_get_serial_sequence({table_literal}, {column_literal}), "
                f"COALESCE(MAX({quoted_column}), 0) + 1, false"
                f") FROM {quoted_table};"
            )

        if sequence_statements:
            statements.append("-- Reset sequences after data import")
            statements.extend(sequence_statements)

    if disable_triggers and has_schmuckstueck:
        statements.append("-- Re-enable triggers")
        statements.append('ALTER TABLE "Schmuckstück" ENABLE TRIGGER ALL;')

    if include_transaction:
        statements.append("COMMIT;")

    stats = ConversionStats(
        table_rows=table_rows,
        table_statements=table_statements,
        total_rows=total_rows,
        total_statements=sum(table_statements.values()),
    )
    return statements, stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Konvertiert GoldRegenDB JSON-Backups in PostgreSQL-SQL-Statements."
    )
    parser.add_argument("input_json", help="Pfad zur JSON-Datei")
    parser.add_argument(
        "output_sql", nargs="?", help="Pfad zur SQL-Ausgabedatei (optional)"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Anzahl Zeilen pro INSERT-Statement (Default: 500)",
    )
    parser.add_argument(
        "--table",
        action="append",
        default=[],
        help="Nur diese Tabelle konvertieren (mehrfach nutzbar)",
    )
    parser.add_argument(
        "--exclude-table",
        action="append",
        default=[],
        help="Diese Tabelle ausschließen (mehrfach nutzbar)",
    )
    parser.add_argument(
        "--truncate-first",
        action="store_true",
        help="Vor den INSERTs TRUNCATE TABLE ... RESTART IDENTITY CASCADE ausgeben",
    )
    parser.add_argument(
        "--no-transaction",
        action="store_true",
        help="Kein BEGIN/COMMIT erzeugen",
    )
    parser.add_argument(
        "--no-header",
        action="store_true",
        help="Keine Kommentar-Header erzeugen",
    )
    parser.add_argument(
        "--disable-triggers",
        action="store_true",
        help='Für "Schmuckstück" vor Import DISABLE TRIGGER ALL und danach ENABLE TRIGGER ALL ausgeben',
    )
    parser.add_argument(
        "--reset-sequences",
        action="store_true",
        help="Am Ende setval(...) für bekannte SERIAL-Spalten ausgeben",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    input_path = Path(args.input_json)
    if not input_path.exists():
        print(f"❌ JSON-Datei nicht gefunden: {input_path}", file=sys.stderr)
        return 1

    if args.batch_size < 1:
        print("❌ --batch-size muss >= 1 sein.", file=sys.stderr)
        return 1

    output_path = (
        Path(args.output_sql) if args.output_sql else input_path.with_suffix(".sql")
    )

    try:
        payload = json.loads(input_path.read_text(encoding="utf-8"))
        tables, format_name, metadata = detect_tables(payload)
    except json.JSONDecodeError as exc:
        print(f"❌ JSON-Fehler in {input_path}: {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1

    include_tables = set(args.table) if args.table else None
    exclude_tables = set(args.exclude_table)

    statements, stats = convert_tables_to_sql(
        tables=tables,
        batch_size=args.batch_size,
        include_tables=include_tables,
        exclude_tables=exclude_tables,
        include_header=not args.no_header,
        include_transaction=not args.no_transaction,
        truncate_first=args.truncate_first,
        disable_triggers=args.disable_triggers,
        reset_sequences=args.reset_sequences,
    )

    if stats.total_rows == 0:
        print("⚠️ Keine konvertierbaren Tabellenzeilen gefunden.")
        return 1

    output_path.write_text("\n\n".join(statements) + "\n", encoding="utf-8")

    print(f"✓ Format erkannt: {format_name}")
    if metadata:
        print(f"  Metadaten: {metadata}")
    print(f"✓ SQL-Datei erstellt: {output_path}")
    print(f"  Tabellen: {len(stats.table_rows)}")
    print(f"  Zeilen: {stats.total_rows}")
    print(f"  INSERT-Statements: {stats.total_statements}")

    for table_name, row_count in sorted(stats.table_rows.items()):
        stmt_count = stats.table_statements.get(table_name, 0)
        print(f"  - {table_name}: {row_count} Zeilen, {stmt_count} INSERT-Statement(s)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
