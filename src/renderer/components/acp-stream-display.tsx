/**
 * ACP Streaming Display — shows streaming agent output and tool call activity.
 *
 * Used inside AI feature components to render incremental responses
 * while the agent is working.
 */

import type { AcpToolActivity } from "../hooks/use-acp-stream";

import { Spinner } from "@/components/ui/spinner";
import { FileSearch, Pencil, Search, SquareTerminal, Wrench } from "lucide-react";

import { MarkdownBody } from "./markdown-body";

function toolIcon(kind: string | null) {
  switch (kind) {
    case "read":
      return FileSearch;
    case "edit":
    case "delete":
    case "move":
      return Pencil;
    case "search":
      return Search;
    case "execute":
      return SquareTerminal;
    default:
      return Wrench;
  }
}

function ToolCallItem({ tool }: { tool: AcpToolActivity }) {
  const Icon = toolIcon(tool.kind);
  const isActive = tool.status === "pending" || tool.status === "in_progress";

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {isActive ? (
        <Spinner className="text-primary h-3 w-3" />
      ) : (
        <Icon
          size={12}
          className="text-text-ghost"
        />
      )}
      <span
        className={`font-mono text-[10px] ${isActive ? "text-text-secondary" : "text-text-ghost"}`}
      >
        {tool.title}
      </span>
    </div>
  );
}

interface AcpStreamDisplayProps {
  /** Accumulated text from the agent. */
  text: string;
  /** Active tool calls. */
  tools: AcpToolActivity[];
  /** Whether the stream is currently active. */
  streaming: boolean;
  /** CSS class for the markdown body. */
  className?: string;
}

export function AcpStreamDisplay({ text, tools, streaming, className }: AcpStreamDisplayProps) {
  const activeTools = tools.filter((t) => t.status === "pending" || t.status === "in_progress");
  const hasText = text.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Tool call activity */}
      {activeTools.length > 0 && (
        <div className="border-border/50 flex flex-col rounded-md border px-2 py-1.5">
          {activeTools.map((tool) => (
            <ToolCallItem
              key={tool.id}
              tool={tool}
            />
          ))}
        </div>
      )}

      {/* Streaming text */}
      {hasText && (
        <MarkdownBody
          content={text}
          className={className}
        />
      )}

      {/* Loading indicator when streaming but no text yet */}
      {streaming && !hasText && activeTools.length === 0 && (
        <div className="flex items-center gap-2">
          <Spinner className="text-primary h-3 w-3" />
          <span className="text-text-tertiary text-xs">Agent is thinking...</span>
        </div>
      )}
    </div>
  );
}
