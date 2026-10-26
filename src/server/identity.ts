/** How this app introduces itself to database servers (Postgres `application_name`, `PGAPPNAME` for pg_dump/psql). */
import { userInfo } from "node:os";

export const APP_NAME = "Drizzle Explorer";

function systemUser(): string | null {
  try {
    return userInfo().username || null;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? null;
  }
}

/**
 * "Drizzle Explorer (username)" — visible in `pg_stat_activity.application_name`, so DBAs can tell who
 * is connected with what. Postgres keeps only printable ASCII and the first 63 bytes.
 */
export function applicationName(): string {
  const user = systemUser();
  const raw = user ? `${APP_NAME} (${user})` : APP_NAME;
  return raw.replace(/[^\x20-\x7e]/g, "?").slice(0, 63);
}
