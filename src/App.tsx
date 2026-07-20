import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Activation, Balance, RentRequest, Settings } from "./types";
import bundledServices from "./data/services.json";

type View = "dashboard" | "rent" | "history" | "settings";
type Toast = { type: "success" | "error"; message: string } | null;

const popularServices = [
  ["tg", "Telegram"],
  ["wa", "WhatsApp"],
  ["go", "Google"],
  ["ig", "Instagram"],
  ["fb", "Facebook"],
  ["ds", "Discord"],
  ["tw", "Twitter / X"],
  ["ub", "Uber"]
];

const popularCountries = [
  ["*", "任意国家"],
  ["187", "美国"],
  ["16", "英国"],
  ["73", "巴西"],
  ["22", "印度"],
  ["1", "乌克兰"],
  ["0", "俄罗斯"]
];

type ServiceOption = { code: string; name: string };
type CountryOption = { id: string; name: string };

function normalizeServices(raw: unknown): ServiceOption[] {
  const found: ServiceOption[] = [];
  const visit = (value: unknown, hintedCode?: string) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }
    if (!value || typeof value !== "object") {
      if (hintedCode && typeof value === "string") found.push({ code: hintedCode, name: value });
      return;
    }
    const record = value as Record<string, unknown>;
    const code = String(record.code ?? record.service ?? record.id ?? hintedCode ?? "").trim();
    const name = String(record.name ?? record.title ?? record.label ?? "").trim();
    if (code && name && code.length <= 32) found.push({ code, name });
    else Object.entries(record).forEach(([key, nested]) => visit(nested, key));
  };
  visit(raw);
  return found;
}

function mergeServices(...groups: ServiceOption[][]) {
  const byCode = new Map<string, ServiceOption>();
  groups.flat().forEach((item) => {
    const code = item.code.trim();
    const name = item.name.trim();
    if (code && name && !byCode.has(code)) byCode.set(code, { code, name });
  });
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function normalizeCountries(raw: unknown): CountryOption[] {
  const found: CountryOption[] = [];
  const visit = (value: unknown, hintedId?: string) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }
    if (!value || typeof value !== "object") {
      if (hintedId && typeof value === "string") found.push({ id: hintedId, name: value });
      return;
    }
    const record = value as Record<string, unknown>;
    const id = String(record.id ?? record.code ?? record.country ?? hintedId ?? "").trim();
    const name = String(record.name ?? record.title ?? record.label ?? record.eng ?? record.rus ?? "").trim();
    if (id && name && /^-?\d+$/.test(id)) found.push({ id, name });
    else Object.entries(record).forEach(([key, nested]) => visit(nested, key));
  };
  visit(raw);
  const byId = new Map<string, CountryOption>([["*", { id: "*", name: "任意国家" }]]);
  found.forEach((item) => { if (!byId.has(item.id)) byId.set(item.id, item); });
  return [...byId.values()].sort((a, b) => a.id === "*" ? -1 : b.id === "*" ? 1 : a.name.localeCompare(b.name, "en"));
}

function extractQuote(raw: unknown) {
  const prices: number[] = [];
  const counts: number[] = [];
  const visit = (value: unknown, key = "") => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key));
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>).forEach(([nestedKey, nested]) => visit(nested, nestedKey));
    }
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isFinite(number) || number < 0) return;
    if (/price|cost/i.test(key)) prices.push(number);
    if (/count|quantity|qty/i.test(key)) counts.push(number);
  };
  visit(raw);
  return {
    price: prices.length ? Math.min(...prices) : undefined,
    count: counts.length ? counts.reduce((sum, value) => sum + value, 0) : undefined
  };
}

function normalizeServerStatus(rawStatus: unknown, code?: string) {
  if (code) return "OK";
  const status = String(rawStatus ?? "").toUpperCase();
  const direct: Record<string, string> = {
    "0": "WAIT_CODE",
    "1": "OK",
    "2": "WAIT_RETRY",
    "3": "COMPLETE",
    "4": "CANCEL",
    "8": "CANCEL",
    STATUS_WAIT_CODE: "WAIT_CODE",
    STATUS_WAIT_RETRY: "WAIT_RETRY",
    STATUS_WAIT_RESEND: "WAIT_RESEND",
    STATUS_OK: "OK",
    STATUS_CANCEL: "CANCEL",
    ACCESS_CANCEL: "CANCEL",
    ACCESS_ACTIVATION: "COMPLETE"
  };
  return direct[status] || status || "WAIT_CODE";
}

function normalizeServerActivations(raw: unknown): Activation[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).activations)
      ? (raw as Record<string, unknown>).activations as unknown[]
      : [];
  return list.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const activationId = String(item.activationId ?? item.activation_id ?? item.id ?? "").trim();
    if (!activationId) return [];
    const code = String(item.smsCode ?? item.sms_code ?? item.code ?? "").trim() || undefined;
    const createdRaw = String(item.activationTime ?? item.activation_time ?? item.createdAt ?? item.created_at ?? "");
    const createdAt = createdRaw && !Number.isNaN(new Date(createdRaw).getTime())
      ? new Date(createdRaw).toISOString()
      : "";
    const costRaw = item.activationCost ?? item.activation_cost ?? item.cost;
    const cost = costRaw === undefined || costRaw === null || costRaw === "" ? undefined : Number(costRaw);
    return [{
      activationId,
      phone: String(item.phoneNumber ?? item.phone_number ?? item.phone ?? ""),
      service: String(item.serviceCode ?? item.service_code ?? item.service ?? "unknown"),
      country: String(item.countryCode ?? item.country_code ?? item.country ?? ""),
      status: normalizeServerStatus(item.activationStatus ?? item.activation_status ?? item.status, code),
      code,
      cost: Number.isFinite(cost) ? cost : undefined,
      currency: String(item.currency ?? "USD"),
      createdAt,
      updatedAt: new Date().toISOString(),
      source: "server" as const
    }];
  });
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const statusMeta: Record<string, { label: string; tone: string }> = {
  WAIT_CODE: { label: "等待短信", tone: "waiting" },
  WAIT_RETRY: { label: "等待新短信", tone: "waiting" },
  WAIT_RESEND: { label: "等待重发", tone: "waiting" },
  OK: { label: "已收到", tone: "success" },
  COMPLETE: { label: "已完成", tone: "muted" },
  CANCEL: { label: "已取消", tone: "danger" },
  READY: { label: "已就绪", tone: "waiting" }
};

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
      .replace(/^Error invoking remote method '[^']+':\s*/, "")
      .replace(/^GrizzlyApiError:\s*/, "");
  }
  return String(error);
}

function timeAgo(iso?: string) {
  if (!iso) return "刚刚";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

function formatMoney(value?: number, currency = "USD") {
  if (value === undefined || Number.isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
    plus: "M12 5v14M5 12h14",
    history: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l3 2",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z",
    copy: "M8 8h11v11H8zM5 16H4V5h11v1",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    wallet: "M4 6h15v13H4zM4 9h15M15 14h1",
    phone: "M7 3h10v18H7zM10 17h4",
    inbox: "M4 5h16v14H4zM4 14h4l2 2h4l2-2h4",
    check: "m5 12 4 4L19 6",
    x: "M6 6l12 12M18 6 6 18",
    trash: "M5 7h14M9 7V4h6v3m2 0-1 14H8L7 7"
  };
  const strokeOnly = ["plus", "history", "settings", "copy", "refresh", "wallet", "phone", "inbox", "check", "x", "trash"];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={icons[name] || icons.dashboard}
        fill={strokeOnly.includes(name) ? "none" : "currentColor"}
        stroke={strokeOnly.includes(name) ? "currentColor" : "none"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [activations, setActivations] = useState<Activation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [serverSyncing, setServerSyncing] = useState(false);
  const [serverSyncedAt, setServerSyncedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const pollingRef = useRef(false);
  const pollBackoffRef = useRef({ failures: 0, nextAllowedAt: 0 });

  const notify = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 3400);
  }, []);

  const syncServerActivations = useCallback(async (announce = false) => {
    setServerSyncing(true);
    try {
      const remote = normalizeServerActivations(await window.grizzlyDesktop.api.getActiveActivations());
      const merged = await window.grizzlyDesktop.activations.mergeMany(remote);
      setActivations(merged);
      setServerSyncedAt(new Date().toISOString());
      if (announce) notify("success", `已从官网同步 ${remote.length} 条活动记录`);
      return merged;
    } catch (error) {
      if (announce) notify("error", errorMessage(error));
      return window.grizzlyDesktop.activations.list();
    } finally {
      setServerSyncing(false);
    }
  }, [notify]);

  const loadCore = useCallback(async () => {
    const [nextSettings, nextActivations] = await Promise.all([
      window.grizzlyDesktop.settings.get(),
      window.grizzlyDesktop.activations.list()
    ]);
    setSettings(nextSettings);
    setActivations(nextActivations);
    if (nextSettings.hasApiKey) {
      const [balanceResult] = await Promise.allSettled([
        window.grizzlyDesktop.api.getBalance(),
        syncServerActivations()
      ]);
      if (balanceResult.status === "fulfilled") setBalance(balanceResult.value);
      else notify("error", errorMessage(balanceResult.reason));
    }
  }, [notify, syncServerActivations]);

  useEffect(() => {
    loadCore().finally(() => setLoading(false));
  }, [loadCore]);

  const refreshAll = useCallback(async () => {
    if (!settings?.hasApiKey || refreshing) return;
    setRefreshing(true);
    try {
      const [nextBalance] = await Promise.all([
        window.grizzlyDesktop.api.getBalance(),
        syncServerActivations()
      ]);
      setBalance(nextBalance);
    } catch (error) {
      setBalance(null);
      notify("error", errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }, [settings?.hasApiKey, refreshing, notify, syncServerActivations]);

  const pollActive = useCallback(async () => {
    if (!settings?.hasApiKey || pollingRef.current) return;
    if (Date.now() < pollBackoffRef.current.nextAllowedAt) return;
    const active = activations.filter((item) => {
      if (["WAIT_CODE", "WAIT_RETRY", "WAIT_RESEND", "READY", "ACTIVATION"].includes(item.status)) return true;
      if (item.status !== "CANCEL") return false;
      const lastChange = new Date(item.updatedAt || item.createdAt).getTime();
      return Date.now() - lastChange < 10 * 60 * 1000;
    });
    if (!active.length) return;
    pollingRef.current = true;
    try {
      const remote = normalizeServerActivations(await window.grizzlyDesktop.api.getActiveActivations());
      const remoteIds = new Set(remote.map((item) => item.activationId));
      const missing = active.filter((item) => !remoteIds.has(item.activationId)).slice(0, 12);
      const checked = await mapWithConcurrency(missing, 3, async (item) => {
        try {
          const result = await window.grizzlyDesktop.api.getStatusV2(item.activationId);
          if (result.status !== item.status || result.code !== item.code || result.smsText !== item.smsText) {
            return { ...item, ...result };
          }
        } catch {
          return null;
        }
        return null;
      });
      const changed = checked.filter(Boolean) as Activation[];
      const merged = await window.grizzlyDesktop.activations.mergeMany([...remote, ...changed]);
      setActivations(merged);
      pollBackoffRef.current = { failures: 0, nextAllowedAt: 0 };
      if (changed.some((item) => item.code) || remote.some((item) => item.code && !activations.find((old) => old.activationId === item.activationId)?.code)) {
        notify("success", "验证码已收到");
      }
    } catch {
      const failures = pollBackoffRef.current.failures + 1;
      const delay = Math.min(60_000, Math.max(5_000, (settings.pollInterval || 5) * 1000 * (2 ** failures)));
      pollBackoffRef.current = { failures, nextAllowedAt: Date.now() + delay };
      const fallback = active.slice(0, 3);
      const checked = await mapWithConcurrency(fallback, 3, async (item) => {
        try {
          const result = await window.grizzlyDesktop.api.getStatusV2(item.activationId);
          return result.status !== item.status || result.code !== item.code ? { ...item, ...result } : null;
        } catch {
          return null;
        }
      });
      const changed = checked.filter(Boolean) as Activation[];
      if (changed.length) {
        const merged = await window.grizzlyDesktop.activations.mergeMany(changed);
        setActivations(merged);
        if (changed.some((item) => item.code)) notify("success", "验证码已收到");
      }
    } finally {
      pollingRef.current = false;
    }
  }, [activations, settings?.hasApiKey, settings?.pollInterval, notify]);

  useEffect(() => {
    if (!settings?.hasApiKey) return;
    const timer = window.setInterval(pollActive, (settings.pollInterval || 5) * 1000);
    return () => window.clearInterval(timer);
  }, [pollActive, settings]);

  const activeCount = activations.filter((item) => ["WAIT_CODE", "WAIT_RETRY", "WAIT_RESEND", "READY", "ACTIVATION"].includes(item.status)).length;
  const receivedCount = activations.filter((item) => Boolean(item.code)).length;

  if (loading || !settings) {
    return <div className="splash"><div className="bear-mark">G</div><p>正在启动安全客户端…</p></div>;
  }

  if (!settings.hasApiKey) {
    return <>
      <Onboarding settings={settings} onConnected={async () => { await loadCore(); setView("dashboard"); }} notify={notify} />
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">G</div>
          <div><strong>Grizzly</strong><span>SMS Desktop</span></div>
        </div>
        <nav>
          <NavButton active={view === "dashboard"} icon="dashboard" label="控制台" onClick={() => setView("dashboard")} />
          <NavButton active={view === "rent"} icon="plus" label="租用号码" onClick={() => setView("rent")} />
          <NavButton active={view === "history"} icon="history" label="历史记录" badge={activations.length || undefined} onClick={() => setView("history")} />
          <NavButton active={view === "settings"} icon="settings" label="设置" onClick={() => setView("settings")} />
        </nav>
        <div className="sidebar-footer">
          <div className={balance ? "connection-dot" : "connection-dot offline"}><i />{balance ? "API 已连接" : "API 连接异常"}</div>
          <button onClick={() => window.grizzlyDesktop.openExternal("https://grizzlysms.com")}>打开 Grizzly SMS ↗</button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">GRIZZLY SMS</p>
            <h1>{view === "dashboard" ? "控制台" : view === "rent" ? "租用新号码" : view === "history" ? "历史记录" : "设置"}</h1>
          </div>
          <button className="icon-button" title="刷新" onClick={refreshAll} disabled={refreshing}>
            <span className={refreshing ? "spin" : ""}><Icon name="refresh" /></span>
          </button>
        </header>

        <div className="content">
          {view === "dashboard" && (
            <Dashboard
              balance={balance}
              activations={activations}
              activeCount={activeCount}
              receivedCount={receivedCount}
              onRent={() => setView("rent")}
              onAction={async (item, action) => {
                try {
                  if (action === "refresh") {
                    const result = await window.grizzlyDesktop.api.getStatusV2(item.activationId);
                    const saved = await window.grizzlyDesktop.activations.save({ ...item, ...result });
                    setActivations((current) => current.map((entry) => entry.activationId === saved.activationId ? saved : entry));
                  } else {
                    const code = action === "complete" ? 6 : 8;
                    const serverResult = await window.grizzlyDesktop.api.setStatus(item.activationId, code);
                    const expectedStatus = action === "complete" ? "COMPLETE" : "CANCEL";
                    if (!serverResult.confirmed || serverResult.status !== expectedStatus) {
                      throw new Error(action === "complete" ? "服务器未确认完成，请刷新后重试" : "服务器未确认取消，请刷新后重试");
                    }
                    const saved = await window.grizzlyDesktop.activations.save({ ...item, status: expectedStatus });
                    setActivations((current) => current.map((entry) => entry.activationId === saved.activationId ? saved : entry));
                    notify("success", action === "complete" ? "激活已完成" : "激活已取消");
                  }
                } catch (error) {
                  notify("error", errorMessage(error));
                }
              }}
              notify={notify}
            />
          )}
          {view === "rent" && (
            <RentNumber
              onCreated={(activation) => {
                setActivations((current) => [activation, ...current]);
                setView("dashboard");
                refreshAll();
              }}
              notify={notify}
            />
          )}
          {view === "history" && (
            <History
              activations={activations}
              syncing={serverSyncing}
              syncedAt={serverSyncedAt}
              onSync={() => syncServerActivations(true)}
              onDelete={async (item) => {
                if (!["COMPLETE", "CANCEL"].includes(item.status)) {
                  notify("error", "活动中的官网记录不能删除，请先完成或取消");
                  return;
                }
                if (!window.confirm(`确定删除激活记录 ${item.activationId} 的本地归档吗？`)) return;
                await window.grizzlyDesktop.activations.remove(item.activationId);
                setActivations((current) => current.filter((entry) => entry.activationId !== item.activationId));
              }}
              notify={notify}
            />
          )}
          {view === "settings" && (
            <SettingsView
              settings={settings}
              onSaved={(next) => setSettings(next)}
              onDisconnected={(next) => { setSettings(next); setBalance(null); }}
              notify={notify}
            />
          )}
        </div>
      </main>
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

function NavButton({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: number; onClick(): void }) {
  return <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}><Icon name={icon} /><span>{label}</span>{badge ? <b>{badge}</b> : null}</button>;
}

function Onboarding({ settings, onConnected, notify }: { settings: Settings; onConnected(): Promise<void>; notify(type: "success" | "error", message: string): void }) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await window.grizzlyDesktop.api.test({ apiKey, baseUrl });
      await window.grizzlyDesktop.settings.save({ apiKey, baseUrl });
      notify("success", "API 连接成功");
      await onConnected();
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding-copy">
        <div className="brand-mark large">G</div>
        <p className="eyebrow">SECURE DESKTOP CLIENT</p>
        <h1>接收验证码，<br /><em>简单一点。</em></h1>
        <p>号码、短信与激活状态集中管理。API Key 使用 Windows 安全存储加密保管。</p>
        <div className="security-note"><span>✓</span> API Key 不会发送给 Grizzly SMS 以外的服务</div>
      </div>
      <form className="connect-card" onSubmit={submit}>
        <span className="step">01 / 01</span>
        <h2>连接账户</h2>
        <p>在 Grizzly SMS 的 API 页面获取你的密钥。</p>
        <button type="button" className="api-key-link" onClick={() => window.grizzlyDesktop.openExternal("https://grizzlysms.com/docs")}>打开 API 文档与 Key 获取页面 ↗</button>
        <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="输入 API Key" autoFocus required /></label>
        <label>API 地址<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} readOnly required /><small className="field-meta">为保护密钥，仅允许 Grizzly SMS 官方 HTTPS API</small></label>
        <button className="primary-button" disabled={busy}>{busy ? "正在验证…" : "验证并连接"}<span>→</span></button>
      </form>
    </div>
  );
}

function Dashboard({ balance, activations, activeCount, receivedCount, onRent, onAction, notify }: {
  balance: Balance | null;
  activations: Activation[];
  activeCount: number;
  receivedCount: number;
  onRent(): void;
  onAction(item: Activation, action: "refresh" | "complete" | "cancel"): Promise<void>;
  notify(type: "success" | "error", message: string): void;
}) {
  const recent = activations.slice(0, 6);
  return (
    <>
      <section className="stats-grid">
        <div className="stat-card balance-card">
          <div className="stat-icon"><Icon name="wallet" /></div>
          <span>可用余额</span>
          <strong>{balance ? formatMoney(balance.balance, balance.currency) : "—"}</strong>
          <small>Grizzly SMS 账户</small>
        </div>
        <div className="stat-card"><div className="stat-icon amber"><Icon name="phone" /></div><span>进行中</span><strong>{activeCount}</strong><small>正在等待短信</small></div>
        <div className="stat-card"><div className="stat-icon blue"><Icon name="inbox" /></div><span>已收到验证码</span><strong>{receivedCount}</strong><small>全部历史记录</small></div>
        <button className="rent-cta" onClick={onRent}><i><Icon name="plus" /></i><span>租用新号码</span><small>选择服务与国家</small></button>
      </section>

      <section className="account-actions">
        <div>
          <p className="eyebrow">ACCOUNT</p>
          <h2>账户与资金</h2>
          <small>在 Grizzly SMS 官网安全完成资金操作</small>
        </div>
        <div className="account-action-buttons">
          <button type="button" className="recharge-action" onClick={() => window.grizzlyDesktop.openExternal("https://grizzlysms.com/profile/pay")}>
            <i><Icon name="plus" /></i>
            <span><strong>账户充值</strong><small>打开官网充值页面</small></span>
            <b>↗</b>
          </button>
          <button type="button" onClick={() => window.grizzlyDesktop.openExternal("https://grizzlysms.com/profile/history")}>
            <i><Icon name="history" /></i>
            <span><strong>余额流水</strong><small>查询官网资金明细</small></span>
            <b>↗</b>
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">ACTIVATIONS</p><h2>最近激活</h2></div>{recent.length > 0 && <span className="live"><i /> 自动刷新中</span>}</div>
        {recent.length === 0 ? (
          <div className="empty-state"><div><Icon name="phone" /></div><h3>还没有号码</h3><p>租用第一个号码后，验证码会自动出现在这里。</p><button className="secondary-button" onClick={onRent}>租用号码</button></div>
        ) : (
          <div className="activation-list">
            {recent.map((item) => <ActivationRow key={item.activationId} item={item} onAction={onAction} notify={notify} />)}
          </div>
        )}
      </section>
    </>
  );
}

type SearchOption = { value: string; label: string };
type QuoteState =
  | { status: "idle" | "loading" | "error"; message: string }
  | { status: "ready"; message: string; price: number; count?: number };

function SearchPicker({
  value,
  options,
  placeholder,
  meta,
  onChange
}: {
  value: string;
  options: SearchOption[];
  placeholder: string;
  meta: string;
  onChange(value: string): void;
}) {
  const [query, setQuery] = useState(() => options.find((option) => option.value === value)?.label || "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();

  const matches = useMemo(() => {
    if (!normalizedQuery) return options.slice(0, 40);
    const starts: SearchOption[] = [];
    const includes: SearchOption[] = [];
    for (const option of options) {
      const code = option.value.toLocaleLowerCase();
      const label = option.label.toLocaleLowerCase();
      if (code.startsWith(normalizedQuery) || label.startsWith(normalizedQuery)) starts.push(option);
      else if (code.includes(normalizedQuery) || label.includes(normalizedQuery)) includes.push(option);
      if (starts.length >= 40) break;
    }
    if (starts.length < 40) starts.push(...includes.slice(0, 40 - starts.length));
    return starts.slice(0, 40);
  }, [normalizedQuery, options]);

  useEffect(() => setActiveIndex(0), [normalizedQuery]);
  useEffect(() => {
    if (!open) setQuery(options.find((option) => option.value === value)?.label || "");
  }, [open, options, value]);

  function select(option: SearchOption) {
    setQuery(option.label);
    onChange(option.value);
    setOpen(false);
  }

  return (
    <div className="search-picker">
      <input
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          onChange("");
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            if (matches.length) setActiveIndex((index) => Math.min(matches.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter" && open && matches[activeIndex]) {
            event.preventDefault();
            select(matches[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        required
      />
      {open && (
        <div className="search-picker-menu">
          {matches.length ? matches.map((option, index) => (
            <button
              type="button"
              key={option.value}
              className={index === activeIndex ? "active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(option)}
            >
              <span>{option.label}</span>
            </button>
          )) : <div className="search-picker-empty">没有匹配的名称</div>}
          {matches.length === 40 && <div className="search-picker-more">继续输入可缩小范围</div>}
        </div>
      )}
      <small className="field-meta">{meta}</small>
    </div>
  );
}

function ActivationRow({ item, onAction, notify }: { item: Activation; onAction(item: Activation, action: "refresh" | "complete" | "cancel"): Promise<void>; notify(type: "success" | "error", message: string): void }) {
  const meta = statusMeta[item.status] || { label: item.status, tone: "muted" };
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const cancelWaitSeconds = Math.max(0, Math.ceil((new Date(item.createdAt).getTime() + 120_000 - now) / 1000));
  useEffect(() => {
    if (!cancelWaitSeconds || ["COMPLETE", "CANCEL"].includes(item.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cancelWaitSeconds, item.status]);
  async function act(action: "refresh" | "complete" | "cancel") {
    if (action === "cancel") {
      if (cancelWaitSeconds > 0) {
        notify("error", `还需等待 ${cancelWaitSeconds} 秒才能取消`);
        return;
      }
      if (!window.confirm(`确定取消号码 ${item.phone} 吗？取消后通常无法恢复。`)) return;
    }
    setBusy(true);
    await onAction(item, action);
    setBusy(false);
  }
  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value);
    notify("success", `${label}已复制`);
  }
  return (
    <article className="activation-row">
      <div className="service-avatar">{item.service.slice(0, 2).toUpperCase()}</div>
      <div className="activation-main"><strong>{item.service.toUpperCase()}</strong><button onClick={() => copy(item.phone, "号码")}>{item.phone}<Icon name="copy" /></button></div>
      <div className="activation-status"><span className={`status ${meta.tone}`}><i />{meta.label}</span><small>{timeAgo(item.updatedAt || item.createdAt)}</small></div>
      <div className="code-box">{item.code ? <button onClick={() => copy(item.code!, "验证码")}><b>{item.code}</b><Icon name="copy" /></button> : <span>••••••</span>}</div>
      <div className="row-actions">
        <button title="立即刷新" disabled={busy} onClick={() => act("refresh")}><Icon name="refresh" /></button>
        {!["COMPLETE", "CANCEL"].includes(item.status) && <button title="完成" disabled={busy} onClick={() => act("complete")}><Icon name="check" /></button>}
        {!["COMPLETE", "CANCEL"].includes(item.status) && <button className="danger-hover" title={cancelWaitSeconds ? `${cancelWaitSeconds} 秒后可取消` : "取消"} disabled={busy || cancelWaitSeconds > 0} onClick={() => act("cancel")}><Icon name="x" /></button>}
      </div>
    </article>
  );
}

function RentNumber({ onCreated, notify }: { onCreated(activation: Activation): void; notify(type: "success" | "error", message: string): void }) {
  const [form, setForm] = useState({ service: "tg", country: "*", maxPrice: "", operator: "" });
  const [busy, setBusy] = useState(false);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle", message: "请选择服务和国家" });
  const quoteRequestRef = useRef(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [services, setServices] = useState<ServiceOption[]>(() =>
    mergeServices(bundledServices as ServiceOption[], popularServices.map(([code, name]) => ({ code, name })))
  );
  const [countries, setCountries] = useState<CountryOption[]>(() =>
    popularCountries.map(([id, name]) => ({ id, name }))
  );
  const serviceOptions = useMemo(
    () => services.map(({ code, name }) => ({ value: code, label: name })),
    [services]
  );
  const countryOptions = useMemo(
    () => countries.map(({ id, name }) => ({ value: id, label: name })),
    [countries]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      window.grizzlyDesktop.api.getServices(),
      window.grizzlyDesktop.api.getCountries()
    ]).then(([serviceResult, countryResult]) => {
      if (cancelled) return;
      if (serviceResult.status === "fulfilled") {
        setServices((current) => mergeServices(normalizeServices(serviceResult.value), current));
      }
      if (countryResult.status === "fulfilled") {
        const normalized = normalizeCountries(countryResult.value);
        if (normalized.length > 1) setCountries(normalized);
      }
      setCatalogLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const requestId = ++quoteRequestRef.current;
    if (!form.service || !form.country) {
      setQuoteState({ status: "idle", message: "请选择服务和国家" });
      return;
    }

    setQuoteState({ status: "loading", message: "正在自动获取价格…" });
    const timer = window.setTimeout(async () => {
      try {
        const result = await window.grizzlyDesktop.api.getPrices({ service: form.service, country: form.country });
        if (requestId !== quoteRequestRef.current) return;
        const quote = extractQuote(result);
        if (quote.price === undefined) {
          setQuoteState({ status: "error", message: "当前条件没有可用报价，请更换服务或国家" });
        } else if (quote.count === 0) {
          setQuoteState({ status: "error", message: `参考价格：${formatMoney(quote.price)} · 当前暂无可用号码` });
        } else {
          setQuoteState({
            status: "ready",
            message: `参考价格：${formatMoney(quote.price)}${quote.count !== undefined ? ` · 可用 ${quote.count} 个` : ""}`,
            price: quote.price,
            count: quote.count
          });
        }
      } catch (error) {
        if (requestId === quoteRequestRef.current) {
          setQuoteState({ status: "error", message: errorMessage(error) });
        }
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [form.country, form.service]);

  const canRent = quoteState.status === "ready";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canRent) {
      notify("error", "请等待价格获取完成后再租用");
      return;
    }
    setBusy(true);
    try {
      const request: RentRequest = {
        service: form.service.trim(),
        country: form.country,
        operator: form.operator.trim() || undefined,
        maxPrice: form.maxPrice ? Number(form.maxPrice) : undefined
      };
      const result = await window.grizzlyDesktop.api.requestNumber(request);
      const activation: Activation = {
        activationId: result.activationId,
        phone: result.phone,
        service: request.service,
        country: String(request.country || "*"),
        status: "WAIT_CODE",
        cost: typeof result.activationCost === "number" ? result.activationCost : undefined,
        currency: typeof result.currency === "string" ? result.currency : "USD",
        createdAt: new Date().toISOString()
      };
      const saved = await window.grizzlyDesktop.activations.save(activation);
      notify("success", "号码租用成功，正在等待短信");
      onCreated(saved);
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="two-column">
      <form className="panel form-panel" onSubmit={submit}>
        <div className="panel-heading"><div><p className="eyebrow">NEW ACTIVATION</p><h2>选择号码</h2></div></div>
        <div className="form-grid">
          <label>
            服务
            <SearchPicker
              value={form.service}
              placeholder="输入服务名称搜索"
              options={serviceOptions}
              onChange={(service) => setForm((current) => ({ ...current, service }))}
              meta={catalogLoading ? "正在同步在线服务…" : `已加载 ${services.length} 个服务，搜索结果最多显示 40 条`}
            />
          </label>
          <label>
            国家
            <SearchPicker
              value={form.country}
              placeholder="输入国家或地区名称搜索"
              options={countryOptions}
              onChange={(country) => setForm((current) => ({ ...current, country }))}
              meta={`${countries.length} 个国家 / 地区`}
            />
          </label>
          <label>价格上限（可选）<input type="number" min="0" step="0.01" value={form.maxPrice} onChange={(e) => setForm({ ...form, maxPrice: e.target.value })} placeholder="例如 2.00" /></label>
          <label>运营商（可选）<input value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })} placeholder="留空表示任意" /></label>
        </div>
        <div className={`price-hint ${quoteState.status}`}><span>{quoteState.message}</span></div>
        <button className="primary-button wide" disabled={busy || !canRent}>
          {busy ? "正在申请号码…" : quoteState.status === "loading" ? "正在获取价格…" : canRent ? "确认租用号码" : "请先选择并获取价格"}
          <span>→</span>
        </button>
      </form>
      <aside className="info-panel">
        <p className="eyebrow">HOW IT WORKS</p><h2>接下来会发生什么？</h2>
        <ol><li><b>1</b><span><strong>获取号码</strong>费用会从 Grizzly SMS 余额扣除。</span></li><li><b>2</b><span><strong>用于验证</strong>复制号码并在目标服务中使用。</span></li><li><b>3</b><span><strong>自动收码</strong>客户端按设置的间隔检查验证码。</span></li><li><b>4</b><span><strong>完成激活</strong>使用验证码后将激活标记为完成。</span></li></ol>
        <div className="warning-note">租号是付费操作。提交前请确认服务、国家和价格上限。</div>
      </aside>
    </div>
  );
}

function History({ activations, syncing, syncedAt, onSync, onDelete, notify }: {
  activations: Activation[];
  syncing: boolean;
  syncedAt: string | null;
  onSync(): Promise<Activation[]>;
  onDelete(item: Activation): Promise<void>;
  notify(type: "success" | "error", message: string): void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => activations.filter((item) => `${item.phone} ${item.service} ${item.code || ""} ${item.activationId}`.toLowerCase().includes(query.toLowerCase())), [activations, query]);
  return (
    <section className="panel history-panel">
      <div className="panel-heading history-heading">
        <div>
          <p className="eyebrow">OFFICIAL ACTIVE + LOCAL ARCHIVE</p>
          <h2>激活记录</h2>
          <small>{syncedAt ? `官网活动记录同步于 ${new Date(syncedAt).toLocaleTimeString("zh-CN")} · 已结束记录保存在本机` : "等待同步官网活动记录"}</small>
        </div>
        <div className="history-tools">
          <button className="sync-button" disabled={syncing} onClick={onSync}><span className={syncing ? "spin" : ""}><Icon name="refresh" /></span>{syncing ? "同步中" : "同步官网"}</button>
          <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索号码、服务或验证码" />
        </div>
      </div>
      {filtered.length === 0 ? <div className="empty-state"><h3>没有匹配的记录</h3><p>官网提供活动记录，已结束记录作为本地归档保存。</p></div> :
        <div className="history-table">
          <div className="table-head"><span>服务 / 号码</span><span>状态</span><span>验证码</span><span>时间</span><span /></div>
          {filtered.map((item) => {
            const meta = statusMeta[item.status] || { label: item.status, tone: "muted" };
            const active = !["COMPLETE", "CANCEL"].includes(item.status);
            return <div className="table-row" key={item.activationId}><span><b>{item.service.toUpperCase()} {item.source === "server" && <em className="server-badge">官网</em>}</b><small>{item.phone}</small></span><span><i className={`status ${meta.tone}`}>{meta.label}</i></span><span><button className="plain-copy" onClick={() => { if (item.code) { navigator.clipboard.writeText(item.code); notify("success", "验证码已复制"); } }}>{item.code || "—"}</button></span><span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span><span><button className="delete-button" disabled={active} title={active ? "活动记录不能删除" : "删除本地归档"} onClick={() => onDelete(item)}><Icon name="trash" /></button></span></div>;
          })}
        </div>
      }
    </section>
  );
}

function SettingsView({ settings, onSaved, onDisconnected, notify }: { settings: Settings; onSaved(settings: Settings): void; onDisconnected(settings: Settings): void; notify(type: "success" | "error", message: string): void }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [pollInterval, setPollInterval] = useState(settings.pollInterval);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (apiKey) await window.grizzlyDesktop.api.test({ apiKey, baseUrl });
      const next = await window.grizzlyDesktop.settings.save({ baseUrl, pollInterval, apiKey: apiKey || undefined });
      onSaved(next);
      setApiKey("");
      notify("success", "设置已保存");
    } catch (error) {
      notify("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-layout">
      <form className="panel settings-card" onSubmit={save}>
        <div className="panel-heading"><div><p className="eyebrow">CONNECTION</p><h2>API 与安全</h2></div><span className="secure-pill">Windows 加密存储</span></div>
        <label>API 地址<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} readOnly required /><small className="field-meta">仅连接 Grizzly SMS 官方 HTTPS API</small></label>
        <label>替换 API Key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="留空表示不修改" /></label>
        <label>验证码轮询间隔<div className="range-row"><input type="range" min="3" max="30" value={pollInterval} onChange={(e) => setPollInterval(Number(e.target.value))} /><b>{pollInterval} 秒</b></div></label>
        <button className="primary-button" disabled={busy}>{busy ? "正在保存…" : "保存设置"}<span>→</span></button>
      </form>
      <section className="panel settings-card danger-zone">
        <p className="eyebrow">ACCOUNT</p><h2>断开账户</h2><p>清除这台电脑上加密保存的 API Key。历史记录不会被删除。</p>
        <button onClick={async () => { const next = await window.grizzlyDesktop.settings.clearApiKey(); onDisconnected(next); }}>清除 API Key</button>
      </section>
    </div>
  );
}

export default App;
