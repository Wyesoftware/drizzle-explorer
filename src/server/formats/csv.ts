/** Minimal RFC 4180 CSV reader/writer. Values are kept as strings; empty unquoted fields become "". */

export function csvEscape(value: unknown, delimiter = ","): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: unknown[], delimiter = ","): string {
  return values.map((v) => csvEscape(v, delimiter)).join(delimiter) + "\r\n";
}

export function parseCsv(text: string, delimiter = ","): { columns: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM

  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Drop trailing fully-empty records (e.g. final newline).
  while (records.length && records[records.length - 1]!.every((f) => f === "")) records.pop();

  const columns = records.shift() ?? [];
  const width = columns.length;
  const rows = records.map((r) => {
    if (r.length === width) return r;
    const out = r.slice(0, width);
    while (out.length < width) out.push("");
    return out;
  });
  return { columns, rows };
}
