import { useEffect } from "react";
import { ArrowUpCircleIcon, MoonIcon, SettingsIcon, SparklesIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSystemInfo } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import { useAiStore } from "@/lib/ai-store";
import { useSettings, useUpdateStore } from "@/lib/settings";
import { useAppStore } from "@/lib/store";
import { checkForUpdates } from "@/lib/updates";

export function StatusBar() {
  const { data } = useSystemInfo();
  const { resolvedTheme, setTheme } = useTheme();
  const aiOpen = useAiStore((s) => s.open);
  const toggleAi = useAiStore((s) => s.toggle);
  const checkUpdates = useSettings((s) => s.checkUpdates);
  const update = useUpdateStore();
  const openSettings = useAppStore((s) => s.openSettings);

  // One update check per app start, when enabled.
  useEffect(() => {
    if (!checkUpdates || update.result) return;
    void checkForUpdates("newOnly");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkUpdates]);

  const newVersion = update.result && !update.result.upToDate && !update.result.error ? update.result.latest : null;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t bg-muted/40 px-2 text-[11px] text-muted-foreground select-none">
      <span title={data?.build ? `Built ${new Date(data.build).toLocaleString()}` : "Running from source"}>
        Drizzle Explorer{data?.version ? ` ${data.version}` : ""}
        {data?.build ? ` (${data.build.slice(0, 16).replace("T", " ")})` : " (dev)"}
      </span>
      {data && (
        <>
          <span>Bun {data.bunVersion}</span>
          <span>
            {data.platform}/{data.arch}
          </span>
          <span className="truncate" title={data.configDir}>
            config: {data.configDir}
          </span>
        </>
      )}
      <span className="ml-auto" />
      {newVersion && (
        <Button variant="ghost" size="xs" className="h-5 gap-1 px-1.5 text-[11px] text-primary" onClick={() => openSettings("updates")}>
          <ArrowUpCircleIcon className="size-3" /> Update {newVersion}
        </Button>
      )}
      <Button
        variant={aiOpen ? "secondary" : "ghost"}
        size="xs"
        className="h-5 gap-1 px-1.5 text-[11px]"
        aria-label="Toggle AI assistant"
        onClick={toggleAi}
      >
        <SparklesIcon className="size-3" /> Assistant
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5"
        aria-label="Toggle theme"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      >
        {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
      <Button variant="ghost" size="icon-xs" className="size-5" aria-label="Settings" onClick={() => openSettings()}>
        <SettingsIcon />
      </Button>
    </footer>
  );
}
