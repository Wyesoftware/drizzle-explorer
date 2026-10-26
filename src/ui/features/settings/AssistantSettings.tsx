import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRoundIcon, Loader2Icon, UserRoundIcon } from "lucide-react";
import type { AiEffort, AiSettings } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/NativeSelect";
import { errorMessage, rpc } from "@/lib/rpc";
import { RateLimitList } from "@/features/ai/RateLimits";
import { SettingRow } from "./SettingsPage";

/** Assistant section of the settings page: account, billing mode, defaults for new chats, usage limits. */
export function AssistantSettings() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["ai", "status"], queryFn: () => rpc("ai.status", {}), staleTime: 30_000 });
  const st = status.data;
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Start from the stored settings (and reset after a save refreshed them).
  useEffect(() => {
    if (st) {
      setDraft(st.settings);
      setApiKeyInput("");
    }
  }, [st]);

  if (!st || !draft) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Loading assistant status…
      </div>
    );
  }

  const dirty =
    draft.authMode !== st.settings.authMode ||
    draft.defaultModel !== st.settings.defaultModel ||
    draft.defaultEffort !== st.settings.defaultEffort ||
    apiKeyInput.trim().length > 0;

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await rpc("ai.updateSettings", {
        authMode: draft.authMode,
        defaultModel: draft.defaultModel,
        defaultEffort: draft.defaultEffort,
        ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["ai", "status"] });
      toast.success("Assistant settings saved");
    } catch (e) {
      toast.error("Could not save settings", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    await rpc("ai.updateSettings", { apiKey: "" });
    await queryClient.invalidateQueries({ queryKey: ["ai", "status"] });
  }

  const account = st.account;

  return (
    <div>
      {!st.available && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{st.detail}</div>}

      <SettingRow label="Billing" description="Use your Claude subscription (Claude Code login) or an Anthropic API key.">
        <Tabs value={draft.authMode} onValueChange={(v) => setDraft((d) => d && { ...d, authMode: v as AiSettings["authMode"] })}>
          <TabsList>
            <TabsTrigger value="subscription">
              <UserRoundIcon /> Subscription
            </TabsTrigger>
            <TabsTrigger value="apiKey">
              <KeyRoundIcon /> API key
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </SettingRow>

      <div className="border-b py-4">
        {draft.authMode === "subscription" ? (
          <div className="rounded-md border px-3 py-2 text-xs">
            {account?.loggedIn ? (
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-muted-foreground">Account</span>
                <span>{account.email ?? "—"}</span>
                <span className="text-muted-foreground">Organization</span>
                <span>{account.orgName ?? "—"}</span>
                <span className="text-muted-foreground">Plan</span>
                <span>
                  <Badge variant="secondary">{account.subscriptionType ?? account.authMethod ?? "unknown"}</Badge>
                </span>
              </div>
            ) : (
              <p className="text-destructive">
                Not logged in. Run <code>claude</code> in a terminal and use <code>/login</code>, then reopen settings.
              </p>
            )}
            <p className="mt-2 text-muted-foreground">Usage counts against your Claude plan limits, not per-token billing.</p>
          </div>
        ) : (
          <div className="grid gap-2 rounded-md border px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Stored key</span>
              <code>{st.settings.apiKey ?? "none"}</code>
              {st.settings.apiKey && (
                <Button variant="ghost" size="xs" onClick={clearKey}>
                  Remove
                </Button>
              )}
            </div>
            <Input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={st.settings.apiKey ? "Paste a new key to replace it" : "sk-ant-…"}
              autoComplete="off"
              className="font-mono text-xs"
            />
            <p className="text-muted-foreground">Billed per token on your Anthropic console account. The key is stored locally in the app config directory.</p>
          </div>
        )}
      </div>

      <SettingRow label="Default model" description="Used for new chats; each chat can switch models under the message box.">
        <NativeSelect value={draft.defaultModel ?? ""} onChange={(e) => setDraft((d) => d && { ...d, defaultModel: e.target.value || null })} className="w-56">
          {st.models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </NativeSelect>
      </SettingRow>
      <SettingRow label="Default reasoning effort" description="How much the model thinks before answering.">
        <NativeSelect
          value={draft.defaultEffort ?? ""}
          onChange={(e) => setDraft((d) => d && { ...d, defaultEffort: (e.target.value || null) as AiEffort | null })}
          className="w-56"
        >
          <option value="">Model default</option>
          {st.efforts.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </NativeSelect>
      </SettingRow>

      <div className="flex items-center justify-end gap-2 py-4">
        <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => { setDraft(st.settings); setApiKeyInput(""); }}>
          Reset
        </Button>
        <Button size="sm" onClick={save} disabled={saving || !dirty || (draft.authMode === "apiKey" && !st.settings.apiKey && !apiKeyInput.trim())}>
          {saving && <Loader2Icon className="animate-spin" />}
          Save
        </Button>
      </div>

      <div className="pt-2">
        <div className="mb-2 text-sm font-medium">Usage limits</div>
        <RateLimitList limits={st.rateLimits} lastApiKeySource={st.lastApiKeySource} lastModel={st.lastModel} />
      </div>
    </div>
  );
}
