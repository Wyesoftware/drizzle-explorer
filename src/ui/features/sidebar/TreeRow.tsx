import type { ReactNode, MouseEvent } from "react";
import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

export function TreeRow({
  depth,
  expandable = false,
  expanded = false,
  loading = false,
  icon,
  label,
  hint,
  selected = false,
  onToggle,
  onClick,
  onDoubleClick,
  trailing,
  title,
}: {
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  selected?: boolean;
  onToggle?: () => void;
  onClick?: (e: MouseEvent) => void;
  onDoubleClick?: () => void;
  trailing?: ReactNode;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "group/row flex h-7 cursor-default items-center gap-1 rounded-md pr-1 text-[13px] select-none hover:bg-muted/70",
        selected && "bg-muted",
      )}
      style={{ paddingLeft: depth * 14 + 4 }}
      onClick={(e) => {
        onClick?.(e);
        if (!onClick && expandable) onToggle?.();
      }}
      onDoubleClick={onDoubleClick}
      title={title}
    >
      <button
        type="button"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground",
          !expandable && "invisible",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        tabIndex={-1}
        aria-label={expanded ? "Collapse" : "Expand"}
      >
        {loading ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <ChevronRightIcon className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        )}
      </button>
      {icon && <span className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <span className="truncate">{label}</span>
      {hint && <span className="ml-1 truncate text-[11px] text-muted-foreground">{hint}</span>}
      <span className="ml-auto flex shrink-0 items-center opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100">
        {trailing}
      </span>
    </div>
  );
}
