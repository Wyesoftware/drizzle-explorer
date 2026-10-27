import { create } from "zustand";
import type { AiEvent, AiMessage, AiMessagePart, AiSessionInfo } from "@shared/types";

interface AiState {
  sessions: AiSessionInfo[];
  activeId: string | null;
  messages: AiMessage[];
  running: boolean;
  setSessions: (sessions: AiSessionInfo[]) => void;
  setActive: (id: string | null, messages: AiMessage[]) => void;
  setRunning: (running: boolean) => void;
  appendUser: (message: AiMessage) => void;
  applyEvent: (event: AiEvent) => void;
}

/** Chat panel state. Message parts are patched in place as SSE events arrive. */
export const useAiStore = create<AiState>((set, get) => ({
  sessions: [],
  activeId: null,
  messages: [],
  running: false,
  setSessions: (sessions) => set({ sessions }),
  setActive: (id, messages) => set({ activeId: id, messages, running: false }),
  setRunning: (running) => set({ running }),
  appendUser: (message) => set((s) => ({ messages: [...s.messages, message] })),

  applyEvent: (event) => {
    let { messages } = get();
    // Events for a turn we have not seen (stream connected late): create the assistant message first.
    if ("messageId" in event && event.messageId && event.type !== "turn_started" && !messages.some((m) => m.id === event.messageId)) {
      messages = [...messages, { id: event.messageId, role: "assistant", parts: [], createdAt: new Date().toISOString() }];
      set({ messages, running: true });
    }
    const patch = (id: string, fn: (m: AiMessage) => AiMessage) =>
      set({ messages: messages.map((m) => (m.id === id ? fn(m) : m)) });
    const partsWith = (m: AiMessage, update: (parts: AiMessagePart[]) => AiMessagePart[]) => ({ ...m, parts: update([...m.parts]) });

    switch (event.type) {
      case "turn_started": {
        if (messages.some((m) => m.id === event.messageId)) return;
        set({
          running: true,
          messages: [...messages, { id: event.messageId, role: "assistant", parts: [], createdAt: new Date().toISOString() }],
        });
        return;
      }
      case "text_delta":
        patch(event.messageId, (m) =>
          partsWith(m, (parts) => {
            const last = parts[parts.length - 1];
            if (last?.type === "text" && !("closed" in last)) {
              parts[parts.length - 1] = { ...last, text: last.text + event.text };
            } else {
              parts.push({ type: "text", text: event.text });
            }
            return parts;
          }),
        );
        return;
      case "assistant_text":
        patch(event.messageId, (m) =>
          partsWith(m, (parts) => {
            const last = parts[parts.length - 1];
            if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: event.text, closed: true } as AiMessagePart;
            else parts.push({ type: "text", text: event.text, closed: true } as AiMessagePart);
            return parts;
          }),
        );
        return;
      case "tool_call":
        patch(event.messageId, (m) =>
          partsWith(m, (parts) => [...parts, { type: "tool", id: event.id, name: event.name, input: event.input }]),
        );
        return;
      case "tool_result":
        patch(event.messageId, (m) =>
          partsWith(m, (parts) =>
            parts.map((p) => (p.type === "tool" && p.id === event.id ? { ...p, output: event.output, isError: event.isError } : p)),
          ),
        );
        return;
      case "turn_done":
        patch(event.messageId, (m) => ({ ...m, stats: event.stats }));
        set({ running: false });
        return;
      case "turn_error":
        if (event.messageId) patch(event.messageId, (m) => ({ ...m, error: event.message }));
        set({ running: false });
        return;
      default:
        return;
    }
  },
}));
