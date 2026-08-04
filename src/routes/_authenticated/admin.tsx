import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, KeyRound, Loader2, Plug, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  activateProviderKey,
  adminOverview,
  claimAdmin,
  deleteProviderKey,
  listProviderKeys,
  listUsers,
  saveProviderKey,
  setUserRole,
  testProviderKey,
} from "@/lib/admin.functions";
import { getMe } from "@/lib/account.functions";
import { AI_PROVIDERS, providerMeta } from "@/lib/ai/providers";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin console — Marginal Economics" },
      {
        name: "description",
        content:
          "Platform admin console: manage roles, plug in your own AI provider keys, and monitor AI usage across the Economics platform.",
      },
      { property: "og:title", content: "Admin console — Marginal Economics" },
      {
        property: "og:description",
        content: "Roles, AI provider keys and usage monitoring for Marginal Economics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const queryClient = useQueryClient();
  const fetchMe = useServerFn(getMe);
  const claim = useServerFn(claimAdmin);

  const me = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });

  const claimMutation = useMutation({
    mutationFn: () => claim(),
    onSuccess: async (result) => {
      if (result.claimed) {
        toast.success("You are now the platform admin.");
        await queryClient.invalidateQueries();
      } else {
        toast.error("An admin already exists — ask them to promote your account.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (me.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (me.data?.role !== "admin") {
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-center">
        <ShieldCheck className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">Admin access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This console shows every user, essay, document and AI call, and is where provider API keys
          live. If nobody has claimed the admin seat yet, you can claim it now.
        </p>
        <Button
          className="mt-5"
          onClick={() => claimMutation.mutate()}
          disabled={claimMutation.isPending}
        >
          {claimMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Claim the admin seat
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Admin console"
        description="Everything in one place: platform totals, user roles, AI usage and your own AI provider keys."
      />
      <div className="px-5 py-6 md:px-8">
        <Tabs defaultValue="providers">
          <TabsList>
            <TabsTrigger value="providers">AI providers</TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="mt-5">
            <ProvidersPanel />
          </TabsContent>
          <TabsContent value="overview" className="mt-5">
            <OverviewPanel />
          </TabsContent>
          <TabsContent value="users" className="mt-5">
            <UsersPanel />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function ProvidersPanel() {
  const queryClient = useQueryClient();
  const list = useServerFn(listProviderKeys);
  const save = useServerFn(saveProviderKey);
  const activate = useServerFn(activateProviderKey);
  const remove = useServerFn(deleteProviderKey);
  const test = useServerFn(testProviderKey);

  const keys = useQuery({ queryKey: ["provider-keys"], queryFn: () => list() });

  const [provider, setProvider] = useState<string>("anthropic");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [activateNow, setActivateNow] = useState(true);

  const meta = providerMeta(provider);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["provider-keys"] });

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          provider: provider as never,
          label: label || meta.label,
          apiKey,
          baseUrl,
          model: model || meta.models[0] || "",
          activate: activateNow,
        },
      }),
    onSuccess: async () => {
      toast.success("Key saved. AI features will use it immediately.");
      setApiKey("");
      setLabel("");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string | null) => activate({ data: { id } }),
    onSuccess: async () => {
      toast.success("Active provider updated.");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: async () => {
      toast.success("Key removed.");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => test({ data: { id } }),
    onSuccess: (result) =>
      result.ok
        ? toast.success(`Key works — ${result.model} replied "${result.reply}"`)
        : toast.error(result.reply),
    onError: (error: Error) => toast.error(error.message),
  });

  const activeKey = (keys.data ?? []).find((row) => row.isActive);

  return (
    <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
      <section className="panel rounded-xl border border-border p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-primary" /> Add a provider key
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Bring your own Claude, Gemini, Grok, OpenAI, Groq, OpenRouter, Mistral or DeepSeek key.
          Keys stay server-side and are never sent to the browser.
        </p>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) => {
                setProvider(value);
                setModel(providerMeta(value).models[0] ?? "");
                setBaseUrl("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_PROVIDERS.filter((item) => item.id !== "lovable").map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={meta.label}
            />
          </div>

          <div className="space-y-1.5">
            <Label>API key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={meta.keyHint}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Model id</Label>
            <Input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={meta.models[0] ?? "model-id"}
            />
            {meta.models.length ? (
              <div className="flex flex-wrap gap-1 pt-1">
                {meta.models.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setModel(suggestion)}
                    className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>
              Base URL <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={meta.baseUrl || "https://your-endpoint/v1"}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Make active</p>
              <p className="text-xs text-muted-foreground">
                Marking, coaching, MCQs and essays all route through it.
              </p>
            </div>
            <Switch checked={activateNow} onCheckedChange={setActivateNow} />
          </div>

          <Button
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || apiKey.trim().length < 8}
          >
            {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save key
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="panel flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
          <div>
            <p className="text-sm font-semibold">
              Currently serving:{" "}
              {activeKey ? `${providerMeta(activeKey.provider).label} · ${activeKey.model}` : "Lovable AI (built in)"}
            </p>
            <p className="text-xs text-muted-foreground">
              {activeKey
                ? "All AI features use your own key and billing."
                : "Uses the built-in credits. If they run out, add your own key on the left."}
            </p>
          </div>
          {activeKey ? (
            <Button variant="outline" size="sm" onClick={() => activateMutation.mutate(null)}>
              <Plug className="size-4" /> Switch back to Lovable AI
            </Button>
          ) : null}
        </div>

        {keys.isLoading ? <Skeleton className="h-28 w-full" /> : null}

        {(keys.data ?? []).map((row) => (
          <div key={row.id} className="panel rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  {row.label}
                  {row.isActive ? (
                    <Badge className="gap-1">
                      <CheckCircle2 className="size-3" /> Active
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {providerMeta(row.provider).label} · {row.model} · key {row.maskedKey}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testMutation.mutate(row.id)}
                  disabled={testMutation.isPending}
                >
                  {testMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Test
                </Button>
                {row.isActive ? null : (
                  <Button size="sm" onClick={() => activateMutation.mutate(row.id)}>
                    Use this
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(row.id)}
                  aria-label={`Delete ${row.label}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}

        {keys.data && keys.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No provider keys yet. Add one on the left to stop depending on built-in credits.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function OverviewPanel() {
  const fetchOverview = useServerFn(adminOverview);
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: () => fetchOverview() });

  if (overview.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!overview.data) return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>;

  const { counts, usage } = overview.data;
  const tiles = [
    { label: "Users", value: counts.users },
    { label: "Essays marked", value: counts.essays },
    { label: "Knowledge documents", value: counts.documents },
    { label: "Indexed sections", value: counts.chunks },
    { label: "MCQ attempts", value: counts.attempts },
    { label: "Calibration anchors", value: counts.anchors },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="panel rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="mt-1 text-xl font-semibold">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="panel rounded-xl border border-border">
        <p className="border-b border-border px-4 py-3 text-sm font-semibold">Recent AI calls</p>
        <div className="divide-y divide-border">
          {usage.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">No AI calls logged yet.</p>
          ) : null}
          {usage.map((row: Record<string, any>) => (
            <div key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs">
              {row.ok ? (
                <CheckCircle2 className="size-3.5 text-primary" />
              ) : (
                <XCircle className="size-3.5 text-destructive" />
              )}
              <span className="font-medium">{row.feature}</span>
              <span className="text-muted-foreground">{row.model}</span>
              {row.latency_ms ? (
                <span className="text-muted-foreground">{row.latency_ms} ms</span>
              ) : null}
              <span className="ml-auto text-muted-foreground">
                {new Date(row.created_at).toLocaleString()}
              </span>
              {row.error_message ? (
                <p className="w-full text-destructive">{row.error_message}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UsersPanel() {
  const queryClient = useQueryClient();
  const fetchUsers = useServerFn(listUsers);
  const updateRole = useServerFn(setUserRole);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => fetchUsers() });

  const roleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "student" | "teacher" | "admin" }) =>
      updateRole({ data: input }),
    onSuccess: async () => {
      toast.success("Role updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (users.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="panel divide-y divide-border rounded-xl border border-border">
      {(users.data ?? []).map((user) => (
        <div key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.fullName ?? "Unnamed account"}</p>
            <p className="text-xs text-muted-foreground">
              {user.school ?? "No school"} · joined {new Date(user.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="ml-auto">
            <Select
              value={user.role}
              onValueChange={(value) =>
                roleMutation.mutate({ userId: user.id, role: value as "student" })
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="teacher">Teacher</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ))}
      {users.data && users.data.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">No accounts yet.</p>
      ) : null}
    </div>
  );
}