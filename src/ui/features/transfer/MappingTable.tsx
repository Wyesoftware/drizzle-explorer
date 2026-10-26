import { CodeIcon } from "lucide-react";
import type { ColumnMapping, ConflictMode } from "@shared/types";
import { NativeSelect } from "@/components/NativeSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Per target column: skip it, fill it from a source column, or compute it with SQL on the target database. */
export type Assignment = { kind: "skip" } | { kind: "column"; source: string } | { kind: "sql"; expression: string };
/** target column → assignment */
export type Mapping = Record<string, Assignment>;

const SQL_OPTION = "\u0000sql";

export function autoMap(sourceColumns: string[], targetColumns: string[]): Mapping {
  const byLower = new Map(sourceColumns.map((s) => [s.toLowerCase(), s]));
  const out: Mapping = {};
  for (const t of targetColumns) {
    const source = byLower.get(t.toLowerCase());
    out[t] = source ? { kind: "column", source } : { kind: "skip" };
  }
  return out;
}

export function MappingTable({
  sourceColumns,
  targetColumns,
  mapping,
  onChange,
  sourceLabel = "Source",
}: {
  sourceColumns: string[];
  targetColumns: string[];
  mapping: Mapping;
  onChange: (mapping: Mapping) => void;
  sourceLabel?: string;
}) {
  const used = new Set(Object.values(mapping).map((a) => (a.kind === "column" ? a.source : null)));
  const set = (target: string, assignment: Assignment) => onChange({ ...mapping, [target]: assignment });
  return (
    <div className="max-h-72 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">Target column</TableHead>
            <TableHead className="h-8">{sourceLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {targetColumns.map((t) => {
            const a = mapping[t] ?? { kind: "skip" };
            const value = a.kind === "column" ? a.source : a.kind === "sql" ? SQL_OPTION : "";
            return (
              <TableRow key={t}>
                <TableCell className="py-1 align-top font-mono text-xs">{t}</TableCell>
                <TableCell className="py-1">
                  <div className="grid gap-1">
                    <NativeSelect
                      value={value}
                      onChange={(e) => {
                        const v = e.target.value;
                        set(t, v === "" ? { kind: "skip" } : v === SQL_OPTION ? { kind: "sql", expression: a.kind === "sql" ? a.expression : "" } : { kind: "column", source: v });
                      }}
                    >
                      <option value="">— skip (use column default) —</option>
                      {sourceColumns.map((s) => (
                        <option key={s} value={s} disabled={used.has(s) && !(a.kind === "column" && a.source === s)}>
                          {s}
                        </option>
                      ))}
                      <option value={SQL_OPTION}>SQL expression…</option>
                    </NativeSelect>
                    {a.kind === "sql" && (
                      <div className="flex items-center gap-1">
                        <CodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <Input
                          value={a.expression}
                          onChange={(e) => set(t, { kind: "sql", expression: e.target.value })}
                          placeholder="now(), 'constant', gen_random_uuid()…"
                          className="h-7 font-mono text-xs"
                          aria-label={`SQL expression for ${t}`}
                        />
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function toMappingList(mapping: Mapping): ColumnMapping[] {
  const out: ColumnMapping[] = [];
  for (const [target, a] of Object.entries(mapping)) {
    if (a.kind === "column") out.push({ target, source: a.source, expression: null });
    else if (a.kind === "sql" && a.expression.trim()) out.push({ target, source: null, expression: a.expression.trim() });
  }
  return out;
}

const CONFLICT_OPTIONS: { value: ConflictMode; label: string; hint: string }[] = [
  { value: "error", label: "Fail", hint: "Stop with an error on a duplicate key (nothing is inserted)." },
  { value: "ignore", label: "Skip existing rows", hint: "Rows that violate the primary key / a unique constraint are skipped." },
  { value: "update", label: "Update existing rows", hint: "Upsert by primary key: existing rows get the imported values." },
];

export function ConflictModeField({ value, onChange }: { value: ConflictMode; onChange: (mode: ConflictMode) => void }) {
  const current = CONFLICT_OPTIONS.find((o) => o.value === value) ?? CONFLICT_OPTIONS[0]!;
  return (
    <div className="grid gap-1">
      <Label>On duplicate key</Label>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value as ConflictMode)}>
        {CONFLICT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      <p className="text-xs text-muted-foreground">{current.hint}</p>
    </div>
  );
}
