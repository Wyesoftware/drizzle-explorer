/** In-memory registry of long-running background jobs (dumps, restores) with a polled log. */
import type { JobInfo, JobKind, JobStatus } from "@shared/types";
import { DriverError } from "./drivers";

const MAX_LINES = 5000;

export interface JobHandle {
  log(line: string): void;
  signal: AbortSignal;
}

class Job {
  state: JobInfo["state"] = "running";
  startedAt = new Date().toISOString();
  finishedAt?: string;
  error?: string;
  result?: JobInfo["result"];
  private lines: string[] = [];
  private dropped = 0;
  readonly controller = new AbortController();

  constructor(
    readonly id: string,
    readonly kind: JobKind,
    readonly title: string,
  ) {}

  log(line: string): void {
    for (const part of line.split(/\r?\n/)) {
      if (!part.length) continue;
      this.lines.push(part);
    }
    if (this.lines.length > MAX_LINES) {
      const excess = this.lines.length - MAX_LINES;
      this.lines.splice(0, excess);
      this.dropped += excess;
    }
  }

  get lineCount(): number {
    return this.dropped + this.lines.length;
  }

  info(): JobInfo {
    return {
      id: this.id,
      kind: this.kind,
      title: this.title,
      state: this.state,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
      result: this.result,
      lineCount: this.lineCount,
    };
  }

  status(offset: number): JobStatus {
    const start = Math.max(0, offset - this.dropped);
    const lines = this.lines.slice(start);
    if (offset < this.dropped) lines.unshift(`… ${this.dropped - offset} earlier lines dropped …`);
    return { ...this.info(), lines, nextOffset: this.lineCount };
  }
}

const jobs = new Map<string, Job>();

export function startJob(
  kind: JobKind,
  title: string,
  run: (job: JobHandle) => Promise<JobInfo["result"] | void>,
): string {
  const job = new Job(crypto.randomUUID(), kind, title);
  jobs.set(job.id, job);
  job.log(`[${new Date().toLocaleTimeString()}] ${title}`);
  void (async () => {
    try {
      const result = await run({ log: (line) => job.log(line), signal: job.controller.signal });
      job.result = result ?? undefined;
      job.state = job.controller.signal.aborted ? "cancelled" : "done";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.error = message;
      job.state = job.controller.signal.aborted ? "cancelled" : "failed";
      job.log(`ERROR: ${message}`);
    } finally {
      job.finishedAt = new Date().toISOString();
      job.log(`[${new Date().toLocaleTimeString()}] ${job.state}`);
    }
  })();
  return job.id;
}

export function listJobs(): JobInfo[] {
  return [...jobs.values()].map((j) => j.info()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function jobStatus(id: string, offset: number): JobStatus {
  const job = jobs.get(id);
  if (!job) throw new DriverError(`Job ${id} not found`, "NOT_FOUND");
  return job.status(Math.max(0, Math.floor(offset || 0)));
}

export function cancelJob(id: string): JobInfo {
  const job = jobs.get(id);
  if (!job) throw new DriverError(`Job ${id} not found`, "NOT_FOUND");
  if (job.state === "running") job.controller.abort();
  return job.info();
}
