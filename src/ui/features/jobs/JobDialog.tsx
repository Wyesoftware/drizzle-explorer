import { useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { JobStatus } from "@shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const POLL_MS = 700;

/** Live log of a background job (dump / restore) with cancel support. */
export function JobDialog({ jobId, open, onOpenChange }: { jobId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open) return;
    offset.current = 0;
    setLines([]);
    setStatus(null);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const s = await rpc("jobs.status", { id: jobId, offset: offset.current });
        if (stopped) return;
        offset.current = s.nextOffset;
        if (s.lines.length) setLines((prev) => [...prev, ...s.lines].slice(-5000));
        setStatus(s);
        setError(null);
        if (s.state === "running") timer = setTimeout(poll, POLL_MS);
      } catch (e) {
        if (!stopped) setError(errorMessage(e));
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, open]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const running = status?.state === "running";

  return (
    <Dialog open={open} onOpenChange={(o) => (!running || !o ? onOpenChange(o) : undefined)}>
      <DialogContent className="sm:max-w-3xl" showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {running && <Loader2Icon className="size-4 animate-spin" />}
            {status?.title ?? "Job"}
            {status && (
              <Badge
                variant={status.state === "failed" ? "destructive" : status.state === "done" ? "default" : "secondary"}
                className="ml-1"
              >
                {status.state}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {status?.result?.path
              ? `${status.result.path}${status.result.bytes !== undefined ? ` · ${formatCount(status.result.bytes)} bytes` : ""}`
              : status?.error
                ? status.error
                : running
                  ? "Running in the background. You can close this window; the job keeps running."
                  : " "}
          </DialogDescription>
        </DialogHeader>
        <pre
          ref={logRef}
          className={cn(
            "h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
            status?.state === "failed" && "border-destructive/50",
          )}
        >
          {lines.join("\n")}
          {error && `\n[ui] ${error}`}
        </pre>
        <DialogFooter>
          {running ? (
            <Button variant="destructive" onClick={() => void rpc("jobs.cancel", { id: jobId })}>
              Cancel job
            </Button>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
