/**
 * useAcpStream — listens for ACP session updates and accumulates streaming state.
 *
 * Tracks:
 * - Text chunks from agent_message_chunk → accumulated text
 * - Tool call activity from tool_call / tool_call_update → active tools list
 * - Whether the stream is active
 */

import type { AcpUpdateEvent } from "../../shared/ipc";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AcpToolActivity {
  id: string;
  title: string;
  kind: string | null;
  status: string;
}

export interface AcpStreamState {
  /** Accumulated text from agent message chunks. */
  text: string;
  /** Currently active tool calls. */
  tools: AcpToolActivity[];
  /** Whether we're actively receiving updates. */
  streaming: boolean;
}

/**
 * Subscribe to ACP streaming updates for a specific session.
 *
 * Call `start(sessionId)` when a prompt begins, `stop()` when it ends.
 * The hook listens for `acp:update` events and builds up state.
 */
export function useAcpStream() {
  const [state, setState] = useState<AcpStreamState>({
    text: "",
    tools: [],
    streaming: false,
  });

  const activeSessionId = useRef<string | null>(null);

  const handleUpdate = useCallback((event: AcpUpdateEvent) => {
    if (event.sessionId !== activeSessionId.current) {
      return;
    }

    const update = event.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const content = update.content as { type: string; text?: string } | undefined;
        if (content?.type === "text" && content.text) {
          setState((prev) => ({
            ...prev,
            text: prev.text + content.text,
          }));
        }
        break;
      }

      case "tool_call": {
        const toolCallId = (update.toolCallId as string) ?? "";
        const title = (update.title as string) ?? "Working...";
        const kind = (update.kind as string) ?? null;
        const status = (update.status as string) ?? "in_progress";

        setState((prev) => ({
          ...prev,
          tools: [
            ...prev.tools.filter((t) => t.id !== toolCallId),
            { id: toolCallId, title, kind, status },
          ],
        }));
        break;
      }

      case "tool_call_update": {
        const toolCallId = (update.toolCallId as string) ?? "";
        const title = update.title as string | undefined;
        const status = update.status as string | undefined;

        setState((prev) => ({
          ...prev,
          tools: prev.tools.map((t) =>
            t.id === toolCallId
              ? { ...t, ...(title ? { title } : {}), ...(status ? { status } : {}) }
              : t,
          ),
        }));
        break;
      }
    }
  }, []);

  useEffect(() => {
    const cleanup = window.api.onAcpUpdate(handleUpdate);
    return cleanup;
  }, [handleUpdate]);

  const start = useCallback((sessionId: string) => {
    activeSessionId.current = sessionId;
    setState({ text: "", tools: [], streaming: true });
  }, []);

  const stop = useCallback(() => {
    activeSessionId.current = null;
    setState((prev) => ({ ...prev, streaming: false }));
  }, []);

  const reset = useCallback(() => {
    activeSessionId.current = null;
    setState({ text: "", tools: [], streaming: false });
  }, []);

  return { ...state, start, stop, reset };
}
