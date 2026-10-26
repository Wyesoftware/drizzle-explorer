import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildWhere } from "../drivers/filters";

const render = (where: ReturnType<typeof buildWhere>) => (where ? new PgDialect().sqlToQuery(where) : null);

describe("buildWhere", () => {
  test("returns null without conditions", () => {
    expect(buildWhere({ filters: [] }, "postgres")).toBeNull();
    expect(buildWhere({ filters: [{ column: "a", op: "in", values: [] }] }, "postgres")).toBeNull();
  });

  test("binds comparison values as parameters", () => {
    const q = render(buildWhere({ filters: [{ column: "id", op: "gte", value: "5" }] }, "postgres"))!;
    expect(q.sql).toBe('"id" >= $1');
    expect(q.params).toEqual(["5"]);
  });

  test("uses the explicit value list for IN and keeps commas inside values", () => {
    const q = render(buildWhere({ filters: [{ column: "tag", op: "in", values: ["a,b", "c"] }] }, "postgres"))!;
    expect(q.sql).toBe('"tag" in ($1, $2)');
    expect(q.params).toEqual(["a,b", "c"]);
  });

  test("orNull widens the condition to NULL rows", () => {
    const q = render(buildWhere({ filters: [{ column: "status", op: "in", values: ["new"], orNull: true }] }, "postgres"))!;
    expect(q.sql).toBe('("status" in ($1) or "status" is null)');
    const only = render(buildWhere({ filters: [{ column: "status", op: "in", values: [], orNull: true }] }, "postgres"))!;
    expect(only.sql).toBe('"status" is null');
  });

  test("escapes LIKE wildcards and picks ilike for postgres", () => {
    const q = render(buildWhere({ filters: [{ column: "name", op: "contains", value: "50%" }] }, "postgres"))!;
    expect(q.sql).toBe("cast(\"name\" as text) ilike $1 escape '\\'");
    expect(q.params).toEqual(["%50\\%%"]);
  });
});
