import { TerminalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CodeView } from "@/components/CodeView";
import { EmptyState } from "@/components/EmptyState";
import { useAppStore, type RoutineTab as RoutineTabModel } from "@/lib/store";

export function RoutineTab({ tab }: { tab: RoutineTabModel }) {
  const { routine } = tab;
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);
  const qualified = `${routine.schema ? `${routine.schema}.` : ""}${routine.name}`;
  const callSql =
    routine.kind === "procedure" ? `call ${qualified}(${placeholders(routine)});` : `select ${qualified}(${placeholders(routine)});`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="truncate font-mono text-sm">
          {qualified}
          <span className="text-muted-foreground">({routine.identityArgs})</span>
          {routine.returnType && <span className="text-muted-foreground"> → {routine.returnType}</span>}
        </span>
        <Badge variant="secondary">{routine.kind}</Badge>
        <Badge variant="outline">{routine.language}</Badge>
        <span className="ml-auto" />
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Open in SQL editor" />}
            onClick={() => openSqlEditor(tab.connectionId, routine.definition ?? callSql)}
          >
            <TerminalIcon />
          </TooltipTrigger>
          <TooltipContent>Open definition in SQL editor</TooltipContent>
        </Tooltip>
      </div>
      {routine.comment && <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">{routine.comment}</div>}
      <div className="min-h-0 flex-1">
        {routine.definition ? (
          <CodeView value={routine.definition} language="sql" />
        ) : (
          <EmptyState
            title="No definition available"
            description={`${routine.kind === "aggregate" ? "Aggregates" : "This routine"} cannot be printed by the database. Try: ${callSql}`}
          />
        )}
      </div>
    </div>
  );
}

function placeholders(routine: { identityArgs: string }): string {
  if (!routine.identityArgs.trim()) return "";
  return routine.identityArgs
    .split(",")
    .map((a) => `<${a.trim()}>`)
    .join(", ");
}
