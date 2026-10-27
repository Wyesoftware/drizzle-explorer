import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectionConfig, TableRowsRequest } from "@shared/types";
import { rpc } from "./rpc";

export const keys = {
  connections: ["connections"] as const,
  status: ["connections", "status"] as const,
  schemas: (connectionId: string) => ["schemas", connectionId] as const,
  tables: (connectionId: string, schema: string | null) => ["tables", connectionId, schema] as const,
  table: (connectionId: string, schema: string | null, table: string) =>
    ["table", connectionId, schema, table] as const,
  routines: (connectionId: string, schema: string | null) => ["routines", connectionId, schema] as const,
  rows: (request: TableRowsRequest) => ["rows", request] as const,
  systemInfo: ["system", "info"] as const,
  savedQueries: (connectionId: string | null) => ["queries", connectionId] as const,
};

export function useConnections() {
  return useQuery({ queryKey: keys.connections, queryFn: () => rpc("connections.list", {}) });
}

export function useConnectionStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: () => rpc("connections.status", {}),
    refetchInterval: 5000,
  });
}

export function useSchemas(connectionId: string, enabled = true) {
  return useQuery({
    queryKey: keys.schemas(connectionId),
    queryFn: () => rpc("schema.schemas", { connectionId }),
    enabled,
    retry: false,
  });
}

export function useTables(connectionId: string, schema: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.tables(connectionId, schema),
    queryFn: () => rpc("schema.tables", { connectionId, schema }),
    enabled,
    retry: false,
  });
}

export function useRoutines(connectionId: string, schema: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.routines(connectionId, schema),
    queryFn: () => rpc("schema.routines", { connectionId, schema }),
    enabled,
    retry: false,
  });
}

export function useTableDetails(connectionId: string, schema: string | null, table: string) {
  return useQuery({
    queryKey: keys.table(connectionId, schema, table),
    queryFn: () => rpc("schema.table", { connectionId, schema, table }),
    retry: false,
  });
}

export function useTableRows(request: TableRowsRequest, enabled = true) {
  return useQuery({
    queryKey: keys.rows(request),
    queryFn: () => rpc("data.rows", request),
    placeholderData: (previous) => previous,
    retry: false,
    enabled,
  });
}

export function useSystemInfo() {
  return useQuery({ queryKey: keys.systemInfo, queryFn: () => rpc("system.info", {}), staleTime: Infinity });
}

/** Named queries of one connection from the SQL library (chat playground entries are never listed). */
export function useSavedQueries(connectionId: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.savedQueries(connectionId),
    queryFn: () => rpc("queries.list", { connectionId }),
    enabled,
  });
}

export function useSaveQuery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string | null; connectionId: string | null; name: string; sql: string }) => rpc("queries.save", input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["queries"] }),
  });
}

export function useDeleteQuery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc("queries.delete", { id }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["queries"] }),
  });
}

export function useSaveConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (config: ConnectionConfig) => rpc("connections.save", { config }),
    onSuccess: (_, config) => {
      void client.invalidateQueries({ queryKey: keys.connections });
      void client.invalidateQueries({ queryKey: keys.status });
      if (config.id) {
        void client.removeQueries({ queryKey: keys.schemas(config.id) });
        void client.removeQueries({ queryKey: ["tables", config.id] });
        void client.removeQueries({ queryKey: ["routines", config.id] });
      }
    },
  });
}

export function useDeleteConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc("connections.delete", { id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.connections });
      void client.invalidateQueries({ queryKey: keys.status });
    },
  });
}

export function useConnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc("connections.connect", { id }),
    onSettled: () => void client.invalidateQueries({ queryKey: keys.status }),
  });
}

export function useDisconnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc("connections.disconnect", { id }),
    onSettled: (_, __, id) => {
      void client.invalidateQueries({ queryKey: keys.status });
      void client.removeQueries({ queryKey: keys.schemas(id) });
      void client.removeQueries({ queryKey: ["tables", id] });
      void client.removeQueries({ queryKey: ["routines", id] });
    },
  });
}
