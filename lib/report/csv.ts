import type { ReportSnapshot } from "@/lib/report/snapshot";

/**
 * Het rapport als CSV, per veld een rij.
 *
 * Handgeschreven, geen dependency. Het formaat is honderd regels en een
 * bibliotheek erbij in een codebase die medische data verwerkt is een bewuste
 * keuze; voor komma's en aanhalingstekens is die keuze nee.
 */

const COLUMNS = [
  "section",
  "field_key",
  "label_en",
  // Beide labels, en label_en blijft op zijn plek staan: een coach die hier een
  // draaitabel op heeft gebouwd verliest zijn kolomverwijzingen niet.
  "label_nl",
  "data_type",
  "required",
  "is_medical",
  "value",
  "status",
  "confidence",
  "proposed_by",
  "source_document",
  "source_page",
  "quote_verified",
  "source_quote",
  "conflict_count",
] as const;

/**
 * Waarden die Excel als formule zou uitvoeren, onschadelijk maken.
 *
 * Dit is geen theoretisch risico. De coach opent deze CSV in Excel, en de
 * waarden komen uit PDF's, WhatsApp-exports en modeloutput: tekst die wij niet
 * schrijven. Begint een cel met =, +, -, @, tab of carriage return, dan voert
 * Excel hem uit. Een enkel aanhalingsteken ervoor maakt er tekst van.
 *
 * Het minteken zit er ook in, en dat kost een nette weergave van "-3" in ruil
 * voor het dichtzetten van "-2+3+cmd|' /c calc'!A0". Die ruil is snel gemaakt.
 */
function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180: aanhalingstekens verdubbelen, en quoten zodra er een scheidingsteken in zit. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const text = neutralise(String(value));
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(snapshot: ReportSnapshot): string {
  const rows: string[] = [COLUMNS.join(",")];

  const ordered = [...snapshot.fields].sort((a, b) =>
    a.section === b.section
      ? a.sortOrder - b.sortOrder
      : a.section.localeCompare(b.section),
  );

  for (const field of ordered) {
    rows.push(
      [
        field.section,
        field.key,
        field.labelEn,
        field.labelNl,
        field.dataType,
        field.required,
        field.isMedical,
        // De weergavewaarde, zodat de CSV hetzelfde zegt als het rapport en de
        // Notion-pagina. De ruwe jsonb-waarde staat in de JSON-export.
        field.displayValue,
        field.status,
        field.confidence,
        field.proposedBy ?? "",
        field.provenance?.documentFilename ?? "",
        field.provenance?.page ?? "",
        field.provenance ? field.provenance.quoteVerified : "",
        field.provenance?.quote ?? "",
        field.conflicts.length,
      ]
        .map(cell)
        .join(","),
    );
  }

  // BOM, anders leest Excel op Windows de Nederlandse tekst in de verkeerde
  // codering en staat er "Allergieen" met een kapotte e in een medisch dossier.
  // CRLF om dezelfde reden: dat is wat Excel als regeleinde verwacht.
  return `﻿${rows.join("\r\n")}\r\n`;
}
