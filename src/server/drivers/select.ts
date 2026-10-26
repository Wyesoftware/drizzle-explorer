import { sql, type SQL } from "drizzle-orm";
import type { ExportColumn } from "@shared/types";
import { DriverError } from "./types";

/** `"col" as "name", (expr) as "name2"` for a custom export select list. Expressions are user SQL, raw by design. */
export function selectList(columns: ExportColumn[]): SQL {
  const names = new Set<string>();
  const items = columns.map((c) => {
    const name = c.name.trim();
    if (!name) throw new DriverError("Every export column needs a name", "BAD_REQUEST");
    if (names.has(name)) throw new DriverError(`Export column "${name}" is listed twice`, "BAD_REQUEST");
    names.add(name);
    if (c.expression?.trim()) return sql`(${sql.raw(c.expression.trim())}) as ${sql.identifier(name)}`;
    if (c.source) return sql`${sql.identifier(c.source)} as ${sql.identifier(name)}`;
    throw new DriverError(`Export column "${name}" has neither a source column nor an expression`, "BAD_REQUEST");
  });
  if (!items.length) throw new DriverError("Select at least one column to export", "BAD_REQUEST");
  return sql.join(items, sql`, `);
}
