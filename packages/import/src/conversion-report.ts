/**
 * Persistent conversion report (ext-source 0.6, docs/ext-source.md; review
 * F04, plan §10.70). The importer's notes used to end on stdout; here they
 * travel inside the package, next to the original they describe, so a
 * reader can see what the conversion transformed or dropped without
 * re-running it. Byte-deterministic: same input, same report.
 */

export type ConversionNoteKind = 'loss' | 'change' | 'info';

export interface ConversionNote {
  kind: ConversionNoteKind;
  message: string;
  /** Occurrences of the identical note. */
  count: number;
}

export interface ConversionReport {
  report: '0.1';
  tool: string;
  toolVersion: string;
  /** Lowercase hex SHA-256 of the embedded original main file. */
  sourceDigest: string;
  entries: ConversionNote[];
}

const LOSS =
  /^(?:dropped|discarded|skipped|removed|unwrapped|no representable|no substitutable)\b/i;
const CHANGE =
  /^(?:replaced|promoted|synthesized|flattened|translated|anchored|merged|decoded|numbered heading|table had|floating image|symbol run|kept|sanitized|moved|revision of)\b/i;

/**
 * Producer-side classification of a note by its wording — a reading aid,
 * not a contract: `loss` (content the canonical document does not carry),
 * `change` (content carried in a different form), `info` (what was
 * embedded or recorded).
 */
export function classifyNote(message: string): ConversionNoteKind {
  if (LOSS.test(message)) return 'loss';
  if (CHANGE.test(message)) return 'change';
  return 'info';
}

/** Aggregates identical notes (first-occurrence order) into report entries. */
export function reportEntries(lines: readonly string[]): ConversionNote[] {
  const entries: ConversionNote[] = [];
  const index = new Map<string, ConversionNote>();
  for (const message of lines) {
    const existing = index.get(message);
    if (existing !== undefined) {
      existing.count++;
      continue;
    }
    const entry: ConversionNote = { kind: classifyNote(message), message, count: 1 };
    index.set(message, entry);
    entries.push(entry);
  }
  return entries;
}

/** Canonical serialization of the report file (two-space JSON, trailing newline). */
export function buildConversionReport(
  lines: readonly string[],
  sourceDigest: string,
  toolVersion: string,
): string {
  const report: ConversionReport = {
    report: '0.1',
    tool: '@wdf-dev/import',
    toolVersion,
    sourceDigest,
    entries: reportEntries(lines),
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
