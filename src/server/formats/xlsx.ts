import * as XLSX from "xlsx";

export function writeXlsx(columns: string[], rows: unknown[][]): Uint8Array {
  const data = [columns, ...rows.map((r) => r.map(cellValue))];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "data");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
}

export function readXlsx(bytes: ArrayBuffer | Uint8Array): { columns: string[]; rows: unknown[][] } {
  const book = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const name = book.SheetNames[0];
  if (!name) return { columns: [], rows: [] };
  const sheet = book.Sheets[name]!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const header = (aoa.shift() ?? []).map((c) => (c === null || c === undefined ? "" : String(c)));
  const rows = aoa.map((r) => {
    const out = r.slice(0, header.length);
    while (out.length < header.length) out.push(null);
    return out;
  });
  return { columns: header, rows };
}

function cellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}
