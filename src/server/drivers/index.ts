import type { ConnectionConfig } from "@shared/types";
import { PostgresDriver } from "./postgres";
import { SqliteDriver } from "./sqlite";
import type { Driver } from "./types";

export type { Driver } from "./types";
export { DriverError } from "./types";

export function createDriver(config: ConnectionConfig): Driver {
  switch (config.dialect) {
    case "postgres":
      return new PostgresDriver(config);
    case "sqlite":
      return new SqliteDriver(config);
    default: {
      const never: never = config;
      throw new Error(`Unsupported dialect: ${(never as ConnectionConfig).dialect}`);
    }
  }
}
