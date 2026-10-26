import { sql, type SQL } from "drizzle-orm";
import type { Dialect, FilterSpec, RowFilter } from "@shared/types";

/** Escape LIKE wildcards so user text matches literally. Used with `escape '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Build a WHERE expression (without the keyword) from structured filters plus an optional raw clause.
 * Structured values are bound as parameters; identifiers are quoted. The raw clause is user SQL by design.
 */
export function buildWhere(filter: RowFilter | undefined, dialect: Dialect): SQL | null {
  const parts: SQL[] = [];
  const escape = sql.raw("escape '\\'");
  const like = dialect === "postgres" ? sql.raw("ilike") : sql.raw("like");

  for (const f of filter?.filters ?? []) {
    if (!f.column) continue;
    const col = sql.identifier(f.column);
    const expr = conditionFor(f, col, like, escape);
    if (f.orNull && f.op !== "is_null" && f.op !== "is_not_null") parts.push(expr ? sql`(${expr} or ${col} is null)` : sql`${col} is null`);
    else if (expr) parts.push(expr);
  }

  const raw = filter?.where?.trim();
  if (raw) parts.push(sql`(${sql.raw(raw)})`);

  return parts.length ? sql.join(parts, sql` and `) : null;
}

/** The SQL for one structured condition, or null when it has nothing to match (empty `in`). */
function conditionFor(f: FilterSpec, col: ReturnType<typeof sql.identifier>, like: SQL, escape: SQL): SQL | null {
  const text = sql`cast(${col} as text)`;
  const v = f.value ?? "";
  switch (f.op) {
    case "eq":
      return sql`${col} = ${v}`;
    case "neq":
      return sql`${col} <> ${v}`;
    case "lt":
      return sql`${col} < ${v}`;
    case "lte":
      return sql`${col} <= ${v}`;
    case "gt":
      return sql`${col} > ${v}`;
    case "gte":
      return sql`${col} >= ${v}`;
    case "contains":
      return sql`${text} ${like} ${`%${escapeLike(v)}%`} ${escape}`;
    case "starts":
      return sql`${text} ${like} ${`${escapeLike(v)}%`} ${escape}`;
    case "ends":
      return sql`${text} ${like} ${`%${escapeLike(v)}`} ${escape}`;
    case "like":
      return sql`${text} like ${v}`;
    case "in": {
      const items =
        f.values ??
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      if (items.length === 0) return null;
      return sql`${col} in (${sql.join(items.map((i) => sql`${i}`), sql`, `)})`;
    }
    case "is_null":
      return sql`${col} is null`;
    case "is_not_null":
      return sql`${col} is not null`;
  }
}

export function orderBy(sort: { column: string; direction: "asc" | "desc" }[] | undefined): SQL {
  if (!sort?.length) return sql``;
  return sql` order by ${sql.join(
    sort.map((s) => sql`${sql.identifier(s.column)} ${s.direction === "desc" ? sql.raw("desc") : sql.raw("asc")}`),
    sql`, `,
  )}`;
}
