import { sql, type SQL } from "drizzle-orm";
import type { ConflictMode } from "@shared/types";
import { DriverError } from "./types";
/** ON CONFLICT clause for `insertRows` (Postgres and SQLite share the upsert syntax). */
export function conflictClause(mode: ConflictMode | undefined, insertedColumns: string[], primaryKey: string[]): SQL {
  if (!mode || mode === "error") return sql``;
  if (mode === "ignore") return sql` on conflict do nothing`;
  if (!primaryKey.length) throw new DriverError('"Update existing rows" needs a primary key on the target table', "BAD_REQUEST");
  const updatable = insertedColumns.filter((c) => !primaryKey.includes(c));
  const target = sql.join(
    primaryKey.map((c) => sql.identifier(c)),
    sql`, `,
  );
  if (!updatable.length) return sql` on conflict (${target}) do nothing`;
  const assignments = sql.join(
    updatable.map((c) => sql`${sql.identifier(c)} = excluded.${sql.identifier(c)}`),
    sql`, `,
  );
  return sql` on conflict (${target}) do update set ${assignments}`;
}
