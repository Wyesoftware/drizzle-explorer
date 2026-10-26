import { useCallback, useMemo, useRef, useState } from "react";
import type { ResultRow, RowChange } from "@shared/types";

export interface PendingChanges {
  /** rowId → edited columns (existing rows). */
  updates: Map<string, Record<string, unknown>>;
  /** rowId (new:N) → values entered (new rows). */
  inserts: Map<string, Record<string, unknown>>;
  /** rowIds of existing rows marked for deletion. */
  deletes: Set<string>;
}

const empty = (): PendingChanges => ({ updates: new Map(), inserts: new Map(), deletes: new Set() });

/** Local, unsaved edits for one table page: DBeaver-style "edit, then Save". */
export function usePendingChanges() {
  const [pending, setPending] = useState<PendingChanges>(empty);
  const counter = useRef(0);

  const mutate = (fn: (p: PendingChanges) => void) =>
    setPending((prev) => {
      const next: PendingChanges = {
        updates: new Map(prev.updates),
        inserts: new Map(prev.inserts),
        deletes: new Set(prev.deletes),
      };
      fn(next);
      return next;
    });

  const setCell = useCallback((rowId: string, column: string, value: unknown, original: unknown) => {
    mutate((p) => {
      if (rowId.startsWith("new:")) {
        p.inserts.set(rowId, { ...(p.inserts.get(rowId) ?? {}), [column]: value });
        return;
      }
      const row = { ...(p.updates.get(rowId) ?? {}) };
      if (valueEquals(value, original)) delete row[column];
      else row[column] = value;
      if (Object.keys(row).length) p.updates.set(rowId, row);
      else p.updates.delete(rowId);
    });
  }, []);

  const addRow = useCallback((values: Record<string, unknown> = {}) => {
    const id = `new:${++counter.current}`;
    mutate((p) => p.inserts.set(id, values));
    return id;
  }, []);

  const toggleDelete = useCallback((rowIds: string[], deleted?: boolean) => {
    mutate((p) => {
      for (const id of rowIds) {
        if (id.startsWith("new:")) {
          p.inserts.delete(id);
          continue;
        }
        const next = deleted ?? !p.deletes.has(id);
        if (next) p.deletes.add(id);
        else p.deletes.delete(id);
      }
    });
  }, []);

  const discardRow = useCallback((rowId: string) => {
    mutate((p) => {
      p.updates.delete(rowId);
      p.inserts.delete(rowId);
      p.deletes.delete(rowId);
    });
  }, []);

  const clear = useCallback(() => setPending(empty()), []);

  const count = pending.updates.size + pending.inserts.size + pending.deletes.size;

  const api = useMemo(
    () => ({ pending, count, setCell, addRow, toggleDelete, discardRow, clear }),
    [pending, count, setCell, addRow, toggleDelete, discardRow, clear],
  );
  return api;
}

export function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}

/** Builds the RPC payload. Keys come from the *original* row values, not the edited ones. */
export function buildChanges(
  pending: PendingChanges,
  originals: Map<string, ResultRow>,
  keyColumns: string[],
): RowChange[] {
  const keyOf = (row: ResultRow) => Object.fromEntries(keyColumns.map((k) => [k, row[k]]));
  const changes: RowChange[] = [];
  for (const [id, values] of pending.updates) {
    if (pending.deletes.has(id)) continue;
    const row = originals.get(id);
    if (row) changes.push({ kind: "update", key: keyOf(row), values });
  }
  for (const id of pending.deletes) {
    const row = originals.get(id);
    if (row) changes.push({ kind: "delete", key: keyOf(row) });
  }
  for (const values of pending.inserts.values()) changes.push({ kind: "insert", values });
  return changes;
}
