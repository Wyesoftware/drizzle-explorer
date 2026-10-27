/**
 * Chat session actions shared by the thread list and the chat pane. They touch the AI store, the app
 * store (playgrounds) and react-query directly so any component can call them.
 */
import { toast } from "sonner";
import type { AiEffort } from "@shared/types";
import { errorMessage, rpc } from "@/lib/rpc";
import { queryClient } from "@/lib/query-client";
import { useAiStore } from "@/lib/ai-store";
import { useAppStore } from "@/lib/store";

const invalidateSessions = () => queryClient.invalidateQueries({ queryKey: ["ai", "sessions"] });

/**
 * Playground SQL per chat as the server last saw it (`queries.setThread`). Edits are pushed with a short
 * debounce so the SQL survives a restart; the assistant's own queries are recorded server-side and
 * only marked here (`markThreadQuery`) so they are not written twice.
 */
const knownThreadSql = new Map<string, string>();
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function markThreadQuery(sessionId: string, sql: string): void {
  knownThreadSql.set(sessionId, sql);
}

export function syncThreadQuery(sessionId: string, connectionId: string | null, sql: string): void {
  // Not loaded yet (or unknown chat): never overwrite what the server holds with an empty editor.
  if (!knownThreadSql.has(sessionId) || knownThreadSql.get(sessionId) === sql) return;
  clearTimeout(syncTimers.get(sessionId));
  syncTimers.set(
    sessionId,
    setTimeout(() => {
      syncTimers.delete(sessionId);
      knownThreadSql.set(sessionId, sql);
      void rpc("queries.setThread", { threadId: sessionId, connectionId, sql }).catch(() => knownThreadSql.delete(sessionId));
    }, 800),
  );
}

/** Makes a chat the active one: loads its messages and makes sure its playground exists. */
export async function loadSession(id: string): Promise<void> {
  try {
    const detail = await rpc("ai.session", { id });
    const ai = useAiStore.getState();
    ai.setActive(id, detail.messages);
    ai.setRunning(detail.running);
    const app = useAppStore.getState();
    app.ensurePlayground(id, detail.title);
    // The playground mirrors the session's connection unless the user already changed it there.
    const playground = useAppStore.getState().playgrounds[id]!;
    const connectionId = playground.connectionId ?? detail.connectionId ?? detail.query?.connectionId ?? null;
    // Restore the playground SQL saved for this chat unless the editor already holds something this run.
    const sql = playground.sql.sql.trim() ? playground.sql.sql : (detail.query?.sql ?? "");
    if (!knownThreadSql.has(id)) knownThreadSql.set(id, detail.query?.sql ?? "");
    if (connectionId !== playground.connectionId || sql !== playground.sql.sql) app.updateTab(playground.sql.id, { connectionId, sql });
  } catch (e) {
    toast.error("Could not load chat", { description: errorMessage(e) });
  }
}

export async function createChat(connectionId?: string | null): Promise<string | null> {
  try {
    const s = await rpc("ai.create", { connectionId: connectionId ?? null });
    await invalidateSessions();
    await loadSession(s.id);
    return s.id;
  } catch (e) {
    toast.error("Could not create chat", { description: errorMessage(e) });
    return null;
  }
}

export async function deleteChat(id: string): Promise<void> {
  try {
    await rpc("ai.delete", { id });
  } catch (e) {
    toast.error("Could not delete chat", { description: errorMessage(e) });
    return;
  }
  useAppStore.getState().removePlayground(id);
  clearTimeout(syncTimers.get(id));
  syncTimers.delete(id);
  knownThreadSql.delete(id);
  const ai = useAiStore.getState();
  if (ai.activeId === id) ai.setActive(null, []);
  await invalidateSessions();
  // Fall back to the most recent remaining chat so the pane never shows an orphaned state.
  if (useAiStore.getState().activeId === null) {
    const next = useAiStore.getState().sessions.find((s) => s.id !== id);
    if (next) await loadSession(next.id);
  }
}

export async function configureSession(
  id: string,
  patch: { title?: string; model?: string | null; effort?: AiEffort | null; connectionId?: string | null },
): Promise<void> {
  try {
    await rpc("ai.configure", { id, ...patch });
    if (patch.connectionId !== undefined) {
      const playground = useAppStore.getState().playgrounds[id];
      if (playground) useAppStore.getState().updateTab(playground.sql.id, { connectionId: patch.connectionId });
    }
    if (patch.title !== undefined) useAppStore.getState().updatePlayground(id, { title: patch.title });
    await invalidateSessions();
  } catch (e) {
    toast.error("Could not update chat", { description: errorMessage(e) });
  }
}
