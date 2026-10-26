import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/NativeSelect";
import { useFormatStore, type FormatScope } from "@/lib/formats";
import {
  DATE_PRESETS,
  EPOCH_UNITS,
  formatCellValue,
  isDateType,
  isNumericType,
  isValidTimeZone,
  localTimeZone,
  type ColumnFormat,
  type DatePreset,
  type EpochUnit,
} from "@/lib/format-value";

const COMMON_ZONES = [
  "UTC",
  "Europe/Kyiv",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Warsaw",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

function allZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return COMMON_ZONES;
  }
}

type Kind = ColumnFormat["kind"];

/** Choose how a column is displayed: dates (format + timezone), numbers (grouping, epoch→date), or raw. */
export function FormatDialog({
  open,
  onOpenChange,
  scope,
  column,
  dataType,
  sample,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: FormatScope;
  column: string;
  dataType: string | null;
  sample: unknown;
}) {
  const current = useFormatStore((s) => s.byScope[scope]?.[column]);
  const defaults = useFormatStore((s) => s.defaults);
  const setFormat = useFormatStore((s) => s.setFormat);
  const setDefaults = useFormatStore((s) => s.setDefaults);

  const dateLike = isDateType(dataType);
  const numeric = isNumericType(dataType);
  const [kind, setKind] = useState<Kind>(current?.kind ?? "auto");
  const [preset, setPreset] = useState<DatePreset>(current?.kind === "date" ? current.preset : defaults.datePreset);
  const [pattern, setPattern] = useState(current?.kind === "date" ? (current.pattern ?? defaults.datePattern) : defaults.datePattern);
  const [timeZone, setTimeZone] = useState(current?.kind === "date" ? current.timeZone : defaults.timeZone);
  const [epoch, setEpoch] = useState<EpochUnit>(current?.kind === "date" ? current.epoch : "auto");
  const [grouping, setGrouping] = useState(current?.kind === "number" ? current.grouping : true);
  const [decimals, setDecimals] = useState(current?.kind === "number" && current.decimals !== null ? String(current.decimals) : "");
  const [asDefault, setAsDefault] = useState(false);

  const zoneValid = timeZone === "utc" || timeZone === "local" || isValidTimeZone(timeZone);
  const zones = useMemo(allZones, []);

  const draft: ColumnFormat = useMemo(() => {
    switch (kind) {
      case "date":
        return { kind, preset, pattern, timeZone, epoch };
      case "number":
        return { kind, grouping, decimals: decimals.trim() === "" ? null : Math.max(0, Math.min(20, Number(decimals) || 0)) };
      case "raw":
        return { kind };
      default:
        return { kind: "auto" };
    }
  }, [kind, preset, pattern, timeZone, epoch, grouping, decimals]);

  const preview = sample === null || sample === undefined ? "NULL" : (formatCellValue(sample, draft, dataType, defaults) ?? String(sample));

  function apply() {
    setFormat(scope, column, draft);
    if (asDefault && kind === "date") setDefaults({ datePreset: preset, datePattern: pattern, timeZone });
    onOpenChange(false);
  }

  function reset() {
    setFormat(scope, column, null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Format <span className="font-mono">{column}</span>
          </DialogTitle>
          <DialogDescription>
            {dataType ? `Column type: ${dataType}. ` : ""}Only affects how values are displayed; exports keep the raw values.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <TabsList className="w-full">
              <TabsTrigger value="auto" className="flex-1">
                Auto
              </TabsTrigger>
              <TabsTrigger value="date" className="flex-1">
                Date / time
              </TabsTrigger>
              <TabsTrigger value="number" className="flex-1">
                Number
              </TabsTrigger>
              <TabsTrigger value="raw" className="flex-1">
                Raw
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {kind === "auto" && (
            <p className="text-xs text-muted-foreground">
              {dateLike
                ? `Date columns use the global default (${defaults.datePreset === "custom" ? defaults.datePattern : defaults.datePreset}, ${defaults.timeZone}).`
                : "Values are shown as the database returns them."}
            </p>
          )}

          {kind === "date" && (
            <>
              <div className="grid gap-1.5">
                <Label>Format</Label>
                <NativeSelect value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)}>
                  {DATE_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {preset === "custom" && (
                <div className="grid gap-1.5">
                  <Label>Pattern</Label>
                  <Input value={pattern} onChange={(e) => setPattern(e.target.value)} className="font-mono text-xs" />
                  <p className="text-[11px] text-muted-foreground">Tokens: YYYY MM DD HH mm ss SSS Z ddd</p>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>Time zone</Label>
                <div className="flex gap-2">
                  <NativeSelect
                    value={timeZone === "utc" || timeZone === "local" ? timeZone : "custom"}
                    onChange={(e) => setTimeZone(e.target.value === "custom" ? COMMON_ZONES[1]! : e.target.value)}
                    className="w-44 shrink-0"
                  >
                    <option value="utc">UTC</option>
                    <option value="local">Local ({localTimeZone()})</option>
                    <option value="custom">Specific zone…</option>
                  </NativeSelect>
                  {timeZone !== "utc" && timeZone !== "local" && (
                    <>
                      <Input
                        list="tz-list"
                        value={timeZone}
                        onChange={(e) => setTimeZone(e.target.value)}
                        placeholder="Europe/Kyiv"
                        className={!zoneValid ? "border-destructive" : undefined}
                      />
                      <datalist id="tz-list">
                        {zones.map((z) => (
                          <option key={z} value={z} />
                        ))}
                      </datalist>
                    </>
                  )}
                </div>
              </div>
              {(numeric || !dateLike) && (
                <div className="grid gap-1.5">
                  <Label>Numbers are Unix time in</Label>
                  <NativeSelect value={epoch} onChange={(e) => setEpoch(e.target.value as EpochUnit)}>
                    {EPOCH_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={asDefault} onCheckedChange={(v) => setAsDefault(Boolean(v))} />
                Use this format and time zone as the default for all date columns
              </label>
            </>
          )}

          {kind === "number" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={grouping} onCheckedChange={(v) => setGrouping(Boolean(v))} />
                Thousands separators
              </label>
              <div className="grid gap-1.5">
                <Label>Decimal places (blank = as is)</Label>
                <Input value={decimals} onChange={(e) => setDecimals(e.target.value)} inputMode="numeric" className="w-24" />
              </div>
            </div>
          )}

          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Preview: </span>
            <span className="font-mono">{preview}</span>
            {sample !== null && sample !== undefined && (
              <span className="ml-2 text-muted-foreground">(raw: {typeof sample === "object" ? JSON.stringify(sample) : String(sample)})</span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={reset} disabled={!current}>
            Reset to auto
          </Button>
          <Button onClick={apply} disabled={kind === "date" && !zoneValid}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
