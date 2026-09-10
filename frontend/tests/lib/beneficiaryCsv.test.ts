import { describe, expect, it } from "vitest";

import {
  BENEFICIARY_CSV_TEMPLATE,
  MAX_CSV_ROWS,
  describeAllocationTotal,
  parseBeneficiaryCsv,
  splitCsvLine,
} from "@/lib/beneficiaryCsv";

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("splitCsvLine", () => {
  it("splits a plain line and trims each field", () => {
    expect(splitCsvLine("Jane, GABC , jane@example.com, 60")).toEqual([
      "Jane",
      "GABC",
      "jane@example.com",
      "60",
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    // "Doe, Jane" is what a spreadsheet exports; splitting on every comma
    // would shift each later column left and turn a name into an address.
    expect(splitCsvLine('"Doe, Jane",GABC,jane@example.com,60')).toEqual([
      "Doe, Jane",
      "GABC",
      "jane@example.com",
      "60",
    ]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(splitCsvLine('"Jane ""JD"" Doe",GABC,j@e.com,60')[0]).toBe('Jane "JD" Doe');
  });

  it("preserves empty fields rather than dropping them", () => {
    expect(splitCsvLine("Jane,,,60")).toEqual(["Jane", "", "", "60"]);
  });
});

describe("parseBeneficiaryCsv", () => {
  it("parses the shipped template without errors", () => {
    const { rows, errors } = parseBeneficiaryCsv(BENEFICIARY_CSV_TEMPLATE);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Jane Doe", allocationBps: 6000 });
    expect(rows[1]).toMatchObject({ name: "John Doe", allocationBps: 4000 });
  });

  it("converts percentages to basis points", () => {
    const { rows } = parseBeneficiaryCsv(`name,address,email,allocation_percent
Jane,${A},jane@example.com,33.33`);

    expect(rows[0].allocationBps).toBe(3333);
  });

  it("accepts a percent sign", () => {
    const { rows } = parseBeneficiaryCsv(`Jane,${A},jane@example.com,60%`);
    expect(rows[0].allocationBps).toBe(6000);
  });

  it("accepts a file with no header row", () => {
    const { rows, errors } = parseBeneficiaryCsv(`Jane,${A},jane@example.com,100`);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("strips a UTF-8 BOM so Excel exports are not misread", () => {
    // Without stripping, the first header cell reads "\uFEFFname" and the
    // header row is imported as a beneficiary.
    const { rows, errors } = parseBeneficiaryCsv(
      `\uFEFFname,address,email,allocation_percent\nJane,${A},jane@example.com,100`,
    );

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Jane");
  });

  it("handles CRLF line endings", () => {
    const { rows, errors } = parseBeneficiaryCsv(
      `name,address,email,allocation_percent\r\nJane,${A},jane@example.com,60\r\nJohn,${B},john@example.com,40\r\n`,
    );

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[1].email).toBe("john@example.com");
  });

  it("ignores blank and trailing lines", () => {
    const { rows, errors } = parseBeneficiaryCsv(
      `Jane,${A},jane@example.com,60\n\n   \nJohn,${B},john@example.com,40\n\n`,
    );

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it("reports every bad row rather than stopping at the first", () => {
    // Re-uploading to discover one more error at a time is the worst version
    // of this feature.
    const { rows, errors } = parseBeneficiaryCsv(
      `Jane,${A},jane@example.com,60\nBroken,${B}\nJohn,${B},john@example.com,abc\nOk,${A},ok@example.com,40`,
    );

    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
    // The good rows still come through.
    expect(rows).toHaveLength(2);
  });

  it("points at the right line number when a header is present", () => {
    const { errors } = parseBeneficiaryCsv(
      `name,address,email,allocation_percent\nJane,${A},jane@example.com,60\nBroken,${B}`,
    );

    expect(errors[0].line).toBe(3);
  });

  it("rejects allocations outside a sensible range", () => {
    for (const value of ["0", "-5", "101", "", "abc"]) {
      const { rows, errors } = parseBeneficiaryCsv(`Jane,${A},jane@example.com,${value}`);
      expect(rows).toHaveLength(0);
      expect(errors).toHaveLength(1);
    }
  });

  it("reports an empty file rather than returning silently", () => {
    expect(parseBeneficiaryCsv("").errors).toHaveLength(1);
    expect(parseBeneficiaryCsv("\n\n  \n").errors).toHaveLength(1);
  });

  it("reports a header-only file as empty", () => {
    const { rows, errors } = parseBeneficiaryCsv("name,address,email,allocation_percent");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("caps the number of imported rows", () => {
    const line = `Jane,${A},jane@example.com,1`;
    const { rows, errors } = parseBeneficiaryCsv(
      Array.from({ length: MAX_CSV_ROWS + 10 }, () => line).join("\n"),
    );

    expect(rows).toHaveLength(MAX_CSV_ROWS);
    // Reported once, not once per excess row.
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Too many rows");
  });
});

describe("describeAllocationTotal", () => {
  it("says nothing when the total is exactly 100%", () => {
    expect(
      describeAllocationTotal([
        { name: "a", address: A, email: "a@e.com", allocationBps: 6000 },
        { name: "b", address: B, email: "b@e.com", allocationBps: 4000 },
      ]),
    ).toBeNull();
  });

  it("names the shortfall in bps when percentages nearly add up", () => {
    // Three rows of 33.33% total 99.99%, which the contract rejects. Being
    // told only "wrong" leaves no way to work out where the gap is.
    const message = describeAllocationTotal(
      Array.from({ length: 3 }, (_, i) => ({
        name: `b${i}`,
        address: A,
        email: `b${i}@e.com`,
        allocationBps: 3333,
      })),
    );

    expect(message).toContain("99.99%");
    expect(message).toContain("1 bps");
    expect(message).toContain("short of");
  });

  it("reports an overshoot as over, not as a negative shortfall", () => {
    const message = describeAllocationTotal([
      { name: "a", address: A, email: "a@e.com", allocationBps: 7000 },
      { name: "b", address: B, email: "b@e.com", allocationBps: 4000 },
    ]);

    expect(message).toContain("110.00%");
    expect(message).toContain("1000 bps over");
    expect(message).not.toContain("-");
  });
});
