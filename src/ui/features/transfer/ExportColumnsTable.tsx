import { CodeIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ExportColumn } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/NativeSelect";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Editor row: an output column that is either a table column or a SQL expression; `include` toggles it. */
export interface ExportColumnDraft {
  id: number;
  include: boolean;
  name: string;
  kind: "column" | "sql";
  source: string;
  expression: string;
}

let nextId = 1;

export function defaultExportColumns(tableColumns: string[]): ExportColumnDraft[] {
  return tableColumns.map((c) => ({ id: nextId++, include: true, name: c, kind: "column", source: c, expression: "" }));
}

/** Converts drafts to the request shape; returns undefined when the list equals "all columns as is". */
export function toExportColumns(drafts: ExportColumnDraft[], tableColumns: string[]): ExportColumn[] | undefined {
  const included = drafts.filter((d) => d.include);
  const unchanged =
    included.length === tableColumns.length &&
    included.every((d, i) => d.kind === "column" && d.source === tableColumns[i] && d.name === tableColumns[i]);
  if (unchanged) return undefined;
  return included.map((d) => ({
    name: d.name.trim() || (d.kind === "column" ? d.source : "expr"),
    source: d.kind === "column" ? d.source : null,
    expression: d.kind === "sql" ? d.expression.trim() : null,
  }));
}

export function ExportColumnsTable({
  tableColumns,
  value,
  onChange,
}: {
  tableColumns: string[];
  value: ExportColumnDraft[];
  onChange: (next: ExportColumnDraft[]) => void;
}) {
  const update = (id: number, patch: Partial<ExportColumnDraft>) => onChange(value.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: number) => onChange(value.filter((d) => d.id !== id));
  const addExpression = () =>
    onChange([...value, { id: nextId++, include: true, name: `expr_${value.length + 1}`, kind: "sql", source: "", expression: "" }]);
  const allOn = value.every((d) => d.include);

  return (
    <div className="grid gap-2">
      <div className="max-h-64 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 w-8">
                <Checkbox checked={allOn} onCheckedChange={(v) => onChange(value.map((d) => ({ ...d, include: Boolean(v) })))} aria-label="Include all" />
              </TableHead>
              <TableHead className="h-8">Column in file</TableHead>
              <TableHead className="h-8">Value</TableHead>
              <TableHead className="h-8 w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {value.map((d) => (
              <TableRow key={d.id} className={d.include ? undefined : "opacity-60"}>
                <TableCell className="py-1 align-top">
                  <Checkbox checked={d.include} onCheckedChange={(v) => update(d.id, { include: Boolean(v) })} aria-label={`Include ${d.name}`} />
                </TableCell>
                <TableCell className="py-1 align-top">
                  <Input value={d.name} onChange={(e) => update(d.id, { name: e.target.value })} className="h-7 font-mono text-xs" aria-label="Output column name" />
                </TableCell>
                <TableCell className="py-1">
                  <div className="grid gap-1">
                    <NativeSelect
                      value={d.kind === "sql" ? "\u0000sql" : d.source}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "\u0000sql") update(d.id, { kind: "sql" });
                        else update(d.id, { kind: "column", source: v, name: d.kind === "sql" || d.name === d.source ? v : d.name });
                      }}
                    >
                      {tableColumns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value={"\u0000sql"}>SQL expression…</option>
                    </NativeSelect>
                    {d.kind === "sql" && (
                      <div className="flex items-center gap-1">
                        <CodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <Input
                          value={d.expression}
                          onChange={(e) => update(d.id, { expression: e.target.value })}
                          placeholder="upper(label), now(), amount * 100…"
                          className="h-7 font-mono text-xs"
                          aria-label={`SQL expression for ${d.name}`}
                        />
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="py-1 align-top">
                  <Button variant="ghost" size="icon-xs" onClick={() => remove(d.id)} aria-label={`Remove ${d.name}`}>
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={addExpression}>
          <PlusIcon /> Add SQL expression column
        </Button>
      </div>
    </div>
  );
}
