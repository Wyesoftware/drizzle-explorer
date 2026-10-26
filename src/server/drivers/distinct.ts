import { sql, type SQL } from "drizzle-orm";
import type { ColumnInfo, Dialect, DistinctValue } from "@shared/types";
import { escapeLike } from "./filters";

/** Up to three text-like columns of a table (other than the key), used as a human-readable label for its rows. */
export function pickLabelColumns(columns: ColumnInfo[], keyColumn: string, textPattern: RegExp): string[] {
  return columns
    .filter((c) => c.name !== keyColumn && textPattern.test(c.dataType))
    .slice(0, 3)
    .map((c) => c.name);
}

export interface DistinctQueryOptions {
  dialect: Dialect;
  relation: SQL;
  column: string;
  search: string;
  limit: number;
  /** Referenced table (foreign keys): its label columns are joined in and searched too. */
  ref?: { relation: SQL; column: string; labelColumns: string[] };
}

/**
 * Distinct non-null values of a column (`value`), optionally joined to the referenced table so that
 * each row also carries label columns `l0..ln`. The search matches the value text or any label.
 */
export function distinctQuery({ dialect, relation, column, search, limit, ref }: DistinctQueryOptions): SQL {
  const col = sql.identifier(column);
  const like = dialect === "postgres" ? sql.raw("ilike") : sql.raw("like");
  const escape = sql.raw("escape '\\'");
  const pattern = `%${escapeLike(search)}%`;
  const labels = ref?.labelColumns.map((name, i) => sql`r.${sql.identifier(name)} as ${sql.identifier(`l${i}`)}`) ?? [];
  const select = sql.join([sql`t.value`, ...labels], sql`, `);
  const from = sql`(select ${col} as value from ${relation} where ${col} is not null group by ${col}) t`;
  const join = ref ? sql` left join ${ref.relation} r on r.${sql.identifier(ref.column)} = t.value` : sql``;
  const searched = [sql`t.value`, ...(ref?.labelColumns.map((name) => sql`r.${sql.identifier(name)}`) ?? [])];
  const where = search
    ? sql` where ${sql.join(
        searched.map((expr) => sql`cast(${expr} as text) ${like} ${pattern} ${escape}`),
        sql` or `,
      )}`
    : sql``;
  return sql`select ${select} from ${from}${join}${where} order by t.value limit ${limit + 1}`;
}

/** Turns query rows into values with their joined label (`l0 · l1 · …`, or null without a reference). */
export function toDistinctValues(rows: Record<string, unknown>[], labelCount: number): DistinctValue[] {
  return rows.map((r) => {
    const parts = Array.from({ length: labelCount }, (_, i) => r[`l${i}`]).filter((v) => v !== null && v !== undefined && v !== "");
    return { value: r.value, label: labelCount ? parts.join(" · ") : null };
  });
}
