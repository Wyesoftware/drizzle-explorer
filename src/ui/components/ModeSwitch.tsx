import { DatabaseIcon, SettingsIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { modKey } from "@/lib/format";
import { useLayout, type AppMode } from "@/lib/layout";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const MODES: { id: AppMode; label: string; icon: typeof DatabaseIcon }[] = [
  { id: "explore", label: "Explore", icon: DatabaseIcon },
  { id: "assistant", label: "Assistant", icon: SparklesIcon },
];

/** Explore / Assistant segmented switch plus the settings gear; sits in the header of both modes. */
export function ModeSwitch() {
  const mode = useLayout((s) => s.mode);
  const setMode = useLayout((s) => s.setMode);
  const openSettings = useAppStore((s) => s.openSettings);
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className="flex h-6 items-center rounded-md bg-muted p-0.5" role="radiogroup" aria-label="Mode">
        {MODES.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === id}
                  className={cn(
                    "flex h-5 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors [&>svg]:size-3",
                    mode === id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                    id === "assistant" && mode === id && "text-primary",
                  )}
                />
              }
              onClick={() => setMode(id)}
            >
              <Icon /> {label}
            </TooltipTrigger>
            <TooltipContent>
              {id === "explore" ? "Connections, tables and SQL editors" : "Chat with the assistant and its playground"} ({modKey}+J switches)
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Settings" />} onClick={() => openSettings()}>
          <SettingsIcon />
        </TooltipTrigger>
        <TooltipContent>Settings ({modKey}+,)</TooltipContent>
      </Tooltip>
    </div>
  );
}
