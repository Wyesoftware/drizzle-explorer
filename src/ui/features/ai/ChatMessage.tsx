import { useState } from "react";
import { BotIcon, CheckIcon, CopyIcon, DatabaseIcon, LoaderIcon, SearchIcon, SparklesIcon, TerminalIcon, XIcon } from "lucide-react";
import type { AiMessage, AiMessagePart } from "@shared/types";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { formatDuration } from "@/lib/format";
import { Markdown } from "./Markdown";

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  list_connections: () => "Listed connections",
  list_schemas: () => "Listed schemas",
  list_tables: (i) => `Listed tables in ${String(i.schema ?? "default schema")}`,
  describe_table: (i) => `Described ${String(i.schema ? `${i.schema}.` : "")}${String(i.table ?? "table")}`,
  run_query: () => "Ran a query in the playground",
  draft_query: () => "Drafted a query in the playground",
};

function toolTitle(part: Extract<AiMessagePart, { type: "tool" }>, done: boolean): string {
  const input = (part.input ?? {}) as Record<string, unknown>;
  const label = TOOL_LABELS[part.name]?.(input) ?? part.name;
  if (!done) return label.replace(/^(Listed|Described|Ran|Drafted)/, (v) => ({ Listed: "Listing", Described: "Describing", Ran: "Running", Drafted: "Drafting" })[v] ?? v);
  if (part.isError) return `Failed: ${label.toLowerCase()}`;
  return label;
}

function ToolIcon({ name }: { name: string }) {
  if (name === "run_query" || name === "draft_query") return <TerminalIcon />;
  if (name === "describe_table") return <SearchIcon />;
  return <DatabaseIcon />;
}

function ToolPart({ part }: { part: Extract<AiMessagePart, { type: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const done = part.output !== undefined;
  const status = !done ? "running" : part.isError ? "error" : undefined;
  const sql = typeof (part.input as { sql?: unknown })?.sql === "string" ? String((part.input as { sql: string }).sql) : null;
  const details = sql ?? JSON.stringify(part.input, null, 2);
  const content = part.isError ? part.output : sql ? details : `${details}\n\n→ ${(part.output ?? "").slice(0, 2000)}`;
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={status}>
          <TraceIcon>{status === "running" ? <LoaderIcon className="animate-spin" /> : status === "error" ? <XIcon /> : <ToolIcon name={part.name} />}</TraceIcon>
          <TraceTitle>{toolTitle(part, done)}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm" variant={part.isError ? "destructive" : "default"} className="mt-1">
          <CodeBlockContent wrap className="max-h-56">
            {content}
          </CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

export function ChatMessage({ message }: { message: AiMessage }) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="muted">
            <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  const tools = message.parts.filter((p): p is Extract<AiMessagePart, { type: "tool" }> => p.type === "tool");
  const texts = message.parts.filter((p): p is Extract<AiMessagePart, { type: "text" }> => p.type === "text" && p.text.trim().length > 0);
  const pending = message.parts.length === 0 && !message.error;
  const allText = texts.map((t) => t.text).join("\n\n");

  return (
    <Message>
      <MessageContent className="gap-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <SparklesIcon className="size-3 text-primary" /> Assistant
        </div>
        {pending && (
          <TraceLine status="running" className="text-xs">
            <TraceIcon>
              <LoaderIcon className="animate-spin" />
            </TraceIcon>
            <TraceTitle>Thinking</TraceTitle>
          </TraceLine>
        )}
        {tools.length > 0 && (
          <Trace className="text-xs">
            {tools.map((t) => (
              <ToolPart key={t.id} part={t} />
            ))}
          </Trace>
        )}
        {texts.map((t, i) => (
          <Markdown key={i} text={t.text} />
        ))}
        {message.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs whitespace-pre-wrap text-destructive">{message.error}</div>
        )}
        {(message.stats || allText) && (
          <MessageFooter className="gap-2 px-0">
            {allText && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Copy answer"
                onClick={async () => {
                  await navigator.clipboard.writeText(allText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            )}
            {message.stats && (
              <span className="text-[11px]">
                {message.stats.turns ? `${message.stats.turns} steps · ` : ""}
                {message.stats.durationMs ? formatDuration(message.stats.durationMs) : ""}
                {message.stats.costUsd ? ` · $${message.stats.costUsd.toFixed(3)}` : ""}
              </span>
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

export { BotIcon };
