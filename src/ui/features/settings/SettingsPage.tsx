import type { ReactNode } from "react";
import {
  ArrowUpCircleIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MonitorIcon,
  MoonIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SunIcon,
  TableIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/NativeSelect";
import { useTheme, type Theme } from "@/lib/theme";
import { useSettings, useUpdateStore, type TableMode } from "@/lib/settings";
import { useSystemInfo } from "@/lib/queries";
import { rpc } from "@/lib/rpc";
import { useAppStore, type SettingsSection, type SettingsTab } from "@/lib/store";
import { checkForUpdates, installUpdate } from "@/lib/updates";
import { cn } from "@/lib/utils";
import { AssistantSettings } from "./AssistantSettings";

const PAGE_SIZES = [100, 200, 500, 1000, 5000];

const SECTIONS: { id: SettingsSection; label: string; description: string; icon: ReactNode }[] = [
  { id: "general", label: "General", description: "Appearance of the app.", icon: <SlidersHorizontalIcon /> },
  { id: "table", label: "Table data", description: "How rows are loaded and edited in table tabs.", icon: <TableIcon /> },
  { id: "assistant", label: "Assistant", description: "Account, billing mode, default model and usage limits.", icon: <SparklesIcon /> },
  { id: "updates", label: "Updates & about", description: "Version information and application updates.", icon: <ArrowUpCircleIcon /> },
];

/** Full-page settings: a section menu on the left, one section at a time on the right. */
export function SettingsPage({ tab }: { tab: SettingsTab }) {
  const openSettings = useAppStore((s) => s.openSettings);
  const section = SECTIONS.find((s) => s.id === tab.section) ?? SECTIONS[0]!;

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-2" aria-label="Settings sections">
        <div className="px-2 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Settings</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === section.id}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm [&>svg]:size-4 [&>svg]:shrink-0",
              s.id === section.id
                ? "bg-background font-medium text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => openSettings(s.id)}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-8 py-6">
          <h1 className="text-lg font-semibold">{section.label}</h1>
          <p className="text-sm text-muted-foreground">{section.description}</p>
          <div className="mt-6">
            {section.id === "general" && <GeneralSection />}
            {section.id === "table" && <TableSection />}
            {section.id === "assistant" && <AssistantSettings />}
            {section.id === "updates" && <UpdatesSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One labelled setting: label + description on the left, the control on the right. */
export function SettingRow({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-8 border-b py-4 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

function GeneralSection() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <SettingRow label="Theme" description="Follow the system appearance or pin light / dark.">
        <Tabs value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <TabsList>
            <TabsTrigger value="light">
              <SunIcon /> Light
            </TabsTrigger>
            <TabsTrigger value="dark">
              <MoonIcon /> Dark
            </TabsTrigger>
            <TabsTrigger value="system">
              <MonitorIcon /> System
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </SettingRow>
    </div>
  );
}

function TableSection() {
  const settings = useSettings();
  return (
    <div>
      <SettingRow
        label="Row loading"
        description={
          settings.tableMode === "paginated"
            ? "Rows load one page at a time with a pager in the footer."
            : "Rows stream in as you scroll, in blocks of 200. Editing works in both modes."
        }
      >
        <Tabs value={settings.tableMode} onValueChange={(v) => settings.set({ tableMode: v as TableMode })}>
          <TabsList>
            <TabsTrigger value="paginated">Pages</TabsTrigger>
            <TabsTrigger value="infinite">Infinite scroll</TabsTrigger>
          </TabsList>
        </Tabs>
      </SettingRow>
      <SettingRow label="Default page size" description="Rows per page for newly opened tables (page mode).">
        <NativeSelect value={String(settings.pageSize)} onChange={(e) => settings.set({ pageSize: Number(e.target.value) })} className="w-32">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} rows
            </option>
          ))}
        </NativeSelect>
      </SettingRow>
    </div>
  );
}

function UpdatesSection() {
  const settings = useSettings();
  const update = useUpdateStore();
  const info = useSystemInfo();
  const result = update.result;

  return (
    <div>
      <div className="mb-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-xs">
        <span className="text-muted-foreground">Version</span>
        <span>
          {info.data?.version ?? "…"}
          {info.data?.build ? ` · built ${new Date(info.data.build).toLocaleString()}` : " · running from source"}
        </span>
        <span className="text-muted-foreground">Runtime</span>
        <span>
          Bun {info.data?.bunVersion ?? "…"} · {info.data?.platform}/{info.data?.arch}
        </span>
        <span className="text-muted-foreground">Config</span>
        <span className="truncate font-mono" title={info.data?.configDir}>
          {info.data?.configDir ?? "…"}
        </span>
      </div>
      <SettingRow label="Check for updates on start" description="Looks up the latest GitHub release once when the app opens.">
        <Switch checked={settings.checkUpdates} onCheckedChange={(v) => settings.set({ checkUpdates: Boolean(v) })} />
      </SettingRow>
      <SettingRow
        label="Current status"
        description={
          !result ? (
            "Not checked yet."
          ) : result.error ? (
            result.error
          ) : result.upToDate ? (
            `You are on the latest version (${result.current}).`
          ) : (
            <>
              Version <b>{result.latest}</b> is available (you have {result.current}).
              {!result.installable && " No build for this platform is attached; use the release page."}
            </>
          )
        }
      >
        <div className="flex items-center gap-2">
          {result && !result.upToDate && !result.error && result.installable && (
            <Button size="sm" onClick={() => void installUpdate()}>
              <DownloadIcon /> Install and restart
            </Button>
          )}
          {result && !result.upToDate && !result.error && result.url && (
            <Button size="sm" variant="outline" onClick={() => void rpc("system.openExternal", { url: result.url! })}>
              <ExternalLinkIcon /> Release page
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void checkForUpdates("always")} disabled={update.checking}>
            {update.checking ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Check now
          </Button>
        </div>
      </SettingRow>
    </div>
  );
}
