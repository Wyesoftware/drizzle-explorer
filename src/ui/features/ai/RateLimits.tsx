import { GaugeIcon } from "lucide-react";
import type { AiRateLimit } from "@shared/types";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5-hour window",
  seven_day: "Weekly (all models)",
  seven_day_opus: "Weekly (Opus)",
  seven_day_sonnet: "Weekly (Sonnet)",
  seven_day_overage_included: "Weekly incl. overage",
  overage: "Overage",
  default: "Usage",
};

function resetLabel(resetsAt?: number): string {
  if (!resetsAt) return "";
  const ms = resetsAt * (resetsAt < 1e12 ? 1000 : 1) - Date.now();
  if (ms <= 0) return "resets soon";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h >= 24 ? `resets in ${Math.round(h / 24)} d` : h > 0 ? `resets in ${h} h ${m} m` : `resets in ${m} m`;
}

/** List of the latest rate-limit windows reported by Claude Code during the last turns. */
export function RateLimitList({ limits, lastApiKeySource, lastModel }: { limits: AiRateLimit[]; lastApiKeySource: string | null; lastModel: string | null }) {
  return (
    <div className="grid gap-2 rounded-md border px-3 py-2 text-xs">
      {limits.length === 0 ? (
        <p className="text-muted-foreground">No usage information yet. Limits are reported by Claude after the first message.</p>
      ) : (
        limits.map((l) => {
          const pct = Math.round((l.utilization ?? 0) * 100);
          return (
            <div key={l.rateLimitType ?? "default"} className="grid gap-1">
              <div className="flex items-center gap-2">
                <span>{WINDOW_LABELS[l.rateLimitType ?? "default"] ?? l.rateLimitType}</span>
                <span className={cn("ml-auto tabular-nums", l.status === "rejected" && "text-destructive", l.status === "allowed_warning" && "text-amber-600")}>
                  {pct}% used
                </span>
                <span className="text-muted-foreground">{resetLabel(l.resetsAt)}</span>
              </div>
              <Progress value={pct} aria-label={`${pct}% used`} />
            </div>
          );
        })
      )}
      {(lastModel || lastApiKeySource) && (
        <p className="text-muted-foreground">
          Last turn: {lastModel ?? "—"}
          {lastApiKeySource
            ? ` · credentials: ${lastApiKeySource === "none" || lastApiKeySource === "oauth" ? "Claude subscription login" : lastApiKeySource}`
            : ""}
        </p>
      )}
    </div>
  );
}

/** Compact indicator for the prompt toolbar: worst window percentage with a hover breakdown. */
export function RateLimitBadge({ limits }: { limits: AiRateLimit[] }) {
  const worst = limits.reduce((max, l) => Math.max(max, l.utilization ?? 0), 0);
  const pct = Math.round(worst * 100);
  const rejected = limits.some((l) => l.status === "rejected");
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={100}
        closeDelay={100}
        render={<span className={cn("flex h-6 cursor-default items-center gap-1 px-1.5 text-[11px] text-muted-foreground", rejected && "text-destructive")} />}
      >
        <GaugeIcon className="size-3" />
        {limits.length ? `Limits: ${pct}% used` : "Limits"}
      </HoverCardTrigger>
      <HoverCardContent className="w-80 p-2">
        <RateLimitList limits={limits} lastApiKeySource={null} lastModel={null} />
      </HoverCardContent>
    </HoverCard>
  );
}
