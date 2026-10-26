import { format } from "sql-formatter";
import type { Dialect } from "@shared/types";

/** Pretty-prints SQL for the editor. Falls back to the input when the formatter cannot parse it. */
export function formatSql(sql: string, dialect: Dialect | null | undefined): string {
  try {
    return format(sql, {
      language: dialect === "sqlite" ? "sqlite" : "postgresql",
      keywordCase: "upper",
      tabWidth: 2,
      linesBetweenQueries: 2,
    });
  } catch {
    return sql;
  }
}
