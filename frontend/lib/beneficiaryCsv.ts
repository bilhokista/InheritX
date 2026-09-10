/**
 * CSV import for beneficiary rows.
 *
 * Structural parsing only. Whether an address is a real Stellar account, an
 * email is unique, or the allocations total 100% is decided by the existing
 * `validateBeneficiaryDrafts` / `validateContractBeneficiaryDrafts` in
 * `BeneficiaryAllocationRow.tsx` — duplicating those rules here would give the
 * import path its own subtly different idea of what a valid plan is.
 */

/** Columns the template declares, in order. */
export const BENEFICIARY_CSV_COLUMNS = [
  "name",
  "address",
  "email",
  "allocation_percent",
] as const;

/** Downloadable starter file, with a filled example row. */
export const BENEFICIARY_CSV_TEMPLATE = [
  BENEFICIARY_CSV_COLUMNS.join(","),
  "Jane Doe,GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA,jane@example.com,60",
  "John Doe,GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB,john@example.com,40",
].join("\n");

export interface ParsedBeneficiaryRow {
  name: string;
  address: string;
  email: string;
  /** Allocation in basis points. 10000 bps = 100%. */
  allocationBps: number;
}

export interface CsvRowError {
  /** 1-based line number in the uploaded file, so a message can point at it. */
  line: number;
  message: string;
}

export interface ParsedBeneficiaryCsv {
  rows: ParsedBeneficiaryRow[];
  errors: CsvRowError[];
}

/** Guards against someone uploading an unrelated multi-megabyte file. */
export const MAX_CSV_ROWS = 500;

/**
 * Splits one CSV line, honouring double-quoted fields.
 *
 * Written out rather than `line.split(",")` because a beneficiary name is
 * exactly the kind of field that contains a comma — "Doe, Jane" is what a
 * spreadsheet exports, and splitting naively silently shifts every later
 * column left, turning a name into an address.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is an escaped quote.
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

/** Whether a line looks like the template's header rather than data. */
function isHeaderLine(fields: string[]): boolean {
  return fields[0]?.toLowerCase() === BENEFICIARY_CSV_COLUMNS[0];
}

/**
 * Percentage string to basis points.
 *
 * Matches `percentageToBps` in `BeneficiaryAllocationRow.tsx` (round to the
 * nearest bp) so an imported row and a typed row cannot disagree.
 */
function parseAllocationBps(raw: string): number | null {
  const cleaned = raw.replace(/%/g, "").trim();
  if (!cleaned) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;

  return Math.round(value * 100);
}

/**
 * Parses an uploaded CSV into beneficiary rows.
 *
 * Every problem is reported with its line number and parsing continues, so a
 * single bad row does not hide the other nine — re-uploading a file to
 * discover one more error at a time is the worst version of this feature.
 */
export function parseBeneficiaryCsv(text: string): ParsedBeneficiaryCsv {
  const rows: ParsedBeneficiaryRow[] = [];
  const errors: CsvRowError[] = [];

  // Excel writes a UTF-8 BOM and CRLF endings. Without stripping the BOM the
  // first header cell reads "\uFEFFname" and the header is treated as data.
  const normalised = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalised.split("\n");

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return; // blank and trailing lines are not errors

    const lineNumber = index + 1;
    const fields = splitCsvLine(rawLine);

    if (isHeaderLine(fields)) return;

    if (rows.length >= MAX_CSV_ROWS) {
      if (!errors.some((e) => e.message.includes("Too many rows"))) {
        errors.push({
          line: lineNumber,
          message: `Too many rows — at most ${MAX_CSV_ROWS} beneficiaries can be imported at once.`,
        });
      }
      return;
    }

    if (fields.length !== BENEFICIARY_CSV_COLUMNS.length) {
      errors.push({
        line: lineNumber,
        message: `Expected ${BENEFICIARY_CSV_COLUMNS.length} columns (${BENEFICIARY_CSV_COLUMNS.join(", ")}) but found ${fields.length}.`,
      });
      return;
    }

    const [name, address, email, allocation] = fields;
    const allocationBps = parseAllocationBps(allocation);

    if (allocationBps === null) {
      errors.push({
        line: lineNumber,
        message: `"${allocation}" is not a valid allocation percentage (expected a number above 0 and at most 100).`,
      });
      return;
    }

    rows.push({ name, address, email, allocationBps });
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 1, message: "No beneficiary rows found in the file." });
  }

  return { rows, errors };
}

/**
 * Human-readable summary of how far the imported allocations are from 100%.
 *
 * Percentages that each look right can still miss: three rows of 33.33% total
 * 99.99%, which the contract rejects. Naming the shortfall in bps is what lets
 * someone fix it, rather than being told only that it is wrong.
 */
export function describeAllocationTotal(rows: ParsedBeneficiaryRow[]): string | null {
  const total = rows.reduce((sum, row) => sum + row.allocationBps, 0);
  if (total === 10000) return null;

  const diff = 10000 - total;
  const direction = diff > 0 ? "short of" : "over";
  return (
    `Imported allocations total ${(total / 100).toFixed(2)}%, ` +
    `${Math.abs(diff)} bps ${direction} the required 100%.`
  );
}
