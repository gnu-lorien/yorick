import type { CsvRow, LoadedRow } from '@/parse/models/Description';

/**
 * Papa Parse, the two calls this screen makes of it.
 *
 * papaparse is vendored under public/scripts/lib/ as a UMD bundle for
 * RequireJS and is not an npm dependency, so it is not importable here. These
 * two functions reproduce the behaviour the screen depends on -- including the
 * parts the E2E suite has pinned down, which are the interesting ones.
 */

export interface CsvError {
  type: string;
  code: string;
  message: string;
  row?: number;
}

/**
 * `Papa.unparse({fields, data})`.
 *
 * Fields are quoted only when they have to be: when they contain a quote, a
 * comma, a newline, or lead or trail with a space. Quotes inside are doubled.
 * Rows are joined with CRLF and there is no trailing newline -- which matters,
 * because `parseCsv` treats a trailing blank line as a malformed row.
 */
export function unparseCsv(fields: string[], rows: LoadedRow[]): string {
  const line = (cells: unknown[]) => cells.map(csvCell).join(',');
  return [line(fields), ...rows.map((row) => line(fields.map((f) => row[f])))].join('\r\n');
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  // Papa's own Date branch: `JSON.stringify(date).slice(1, 25)`, which is the
  // ISO string without its quotes. It matters here because `attributes` on a
  // Parse object includes `createdAt` and `updatedAt`, so every export carries
  // two Date columns and `String(date)` would write "Mon Jul 27 2015 ..."
  // instead.
  if (value instanceof Date) return JSON.stringify(value).slice(1, 25);
  const text = String(value).replace(/"/g, '""');
  const needsQuotes =
    /["\r\n,]/.test(text) || text.startsWith(' ') || text.endsWith(' ');
  return needsQuotes ? '"' + text + '"' : text;
}

/**
 * `Papa.parse(text, {header: true})`.
 *
 * The first record is the header; every later record becomes an object keyed by
 * it. A record with the wrong number of cells is a `FieldMismatch` error, and
 * the submit handlers abort the whole submission on any error at all -- so a
 * textarea ending in a newline saves nothing, because the empty final line
 * parses as a one-cell record and is "Too few fields". Confirmed live in
 * e2e/helpers/descriptions.js:270.
 */
export function parseCsv(text: string): { fields: string[]; rows: CsvRow[]; errors: CsvError[] } {
  const records = csvRecords(text);
  const errors: CsvError[] = [];
  if (!records.length) return { fields: [], rows: [], errors };

  const fields = records[0] ?? [];
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i] ?? [];
    if (cells.length < fields.length) {
      errors.push({
        type: 'FieldMismatch',
        code: 'TooFewFields',
        message: `Too few fields: expected ${fields.length} fields but parsed ${cells.length}`,
        row: i - 1,
      });
    } else if (cells.length > fields.length) {
      errors.push({
        type: 'FieldMismatch',
        code: 'TooManyFields',
        message: `Too many fields: expected ${fields.length} fields but parsed ${cells.length}`,
        row: i - 1,
      });
    }
    const row: CsvRow = {};
    fields.forEach((field, c) => {
      if (c < cells.length) row[field] = cells[c] ?? '';
    });
    rows.push(row);
  }
  return { fields, rows, errors };
}

/** Split CSV text into records of cells, honouring RFC 4180 quoting. */
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      records.push(cells);
      cells = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length) {
    cells.push(cell);
    records.push(cells);
  }
  return records;
}

