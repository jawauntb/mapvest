"use client";

import {
  type AgentThread,
  type AlertItem,
  ApiError,
  type CockpitRow,
  type EntitlementState,
  type NearbyItem,
  type ResearchArticle,
  type User,
  type WatchEntry,
  addToWatchlist,
  agentChat,
  clearRobinhoodMcp,
  clearSession,
  createAgentClientMessageId,
  fetchAlerts,
  fetchCockpit,
  fetchEntitlements,
  fetchNearby,
  fetchSettings,
  generateMemo,
  getAgentThread,
  getMe,
  getQuote,
  getToken,
  getUser,
  identifyImage,
  listAgentThreads,
  listWatchlist,
  removeFromWatchlist,
  requestCode,
  saveMemoToWatchlist,
  saveRobinhoodMcp,
  setSession as saveSession,
  startPortal,
  verifyCode,
} from "@/lib/mapvest-api";
import { TESTFLIGHT_URL } from "@/lib/site";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { presentPaywallIfQuota, usePaywall } from "./Paywall";

export default function AppPage() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const cached = getUser();
    const token = getToken();
    if (!cached || !token) {
      setReady(true);
      return;
    }
    setUser(cached);
    // Refresh profile in the background; keep the same token (sessions are
    // long-lived, no rotation needed). Only clear the stored session on a
    // definitive "this token will never work again" signal — an unknown
    // user (e.g. after a Postgres reset) or a token that fails verification.
    // A network blip, timeout, or transient 5xx must NOT sign the user out —
    // "stay signed in until explicit Sign out" (Phase 8 Slice B).
    void getMe()
      .then((r) => {
        setUser(r.user);
        window.localStorage.setItem("mapvest.session.user", JSON.stringify(r.user));
      })
      .catch((e) => {
        if (
          e instanceof ApiError &&
          e.status === 401 &&
          /unknown user|invalid token/i.test(e.message)
        ) {
          clearSession();
          setUser(null);
        }
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="app-loading">…</div>;

  return (
    <Home
      user={user}
      onSignedIn={setUser}
      onSignOut={() => {
        clearSession();
        setUser(null);
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */

function SignIn({
  onSignedIn,
  embedded,
}: {
  onSignedIn: (u: User) => void;
  embedded?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode() {
    setErr(null);
    setBusy(true);
    try {
      const r = await requestCode(email.trim().toLowerCase());
      if (r.devCode) setDevCode(r.devCode);
      setStage("code");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not send code");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setErr(null);
    setBusy(true);
    try {
      const r = await verifyCode(email.trim().toLowerCase(), code.trim());
      saveSession(r.session, r.user);
      onSignedIn(r.user);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "invalid code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={embedded ? "app-signin app-signin-embedded" : "app-signin"}>
      {embedded ? null : <h1>Mapvest</h1>}
      <p className="app-sub">
        {stage === "email"
          ? "Enter your email — we'll send you a one-time code."
          : `We sent a code to ${email}. Enter it below.`}
      </p>
      {stage === "email" ? (
        <>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="app-input"
          />
          <button className="app-btn app-btn-primary" disabled={busy || !email} onClick={sendCode}>
            {busy ? "…" : "Send code"}
          </button>
        </>
      ) : (
        <>
          <input
            inputMode="numeric"
            pattern="\d*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6-digit code"
            className="app-input"
          />
          {devCode ? (
            <button className="app-devcode" onClick={() => setCode(devCode)} type="button">
              Demo code (tap to fill): {devCode}
            </button>
          ) : null}
          <button className="app-btn app-btn-primary" disabled={busy || !code} onClick={verify}>
            {busy ? "…" : "Verify"}
          </button>
          <button className="app-link" onClick={() => setStage("email")}>
            Use a different email
          </button>
        </>
      )}
      {err ? <p className="app-err">{err}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type Tab = "home" | "nearby" | "identify" | "research" | "saved";

/**
 * Guests can browse Nearby / Identify / Research without an account — only
 * Home (Sign in / Sign out / settings) and Saved (watchlist) need a session
 * (Phase 8 Slice B). Guests land on Home first so Sign in is one click away.
 */
function Home({
  user,
  onSignedIn,
  onSignOut,
}: {
  user: User | null;
  onSignedIn: (u: User) => void;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("home");

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-brand">Mapvest</div>
        <nav className="app-tabs">
          <TabBtn active={tab === "home"} onClick={() => setTab("home")}>
            Home
          </TabBtn>
          <TabBtn active={tab === "nearby"} onClick={() => setTab("nearby")}>
            Nearby
          </TabBtn>
          <TabBtn active={tab === "identify"} onClick={() => setTab("identify")}>
            Identify
          </TabBtn>
          <TabBtn active={tab === "research"} onClick={() => setTab("research")}>
            Research
          </TabBtn>
          <TabBtn active={tab === "saved"} onClick={() => setTab("saved")}>
            ★ Saved
          </TabBtn>
        </nav>
        {user ? (
          <button className="app-signout" onClick={onSignOut}>
            {user.email} · sign out
          </button>
        ) : (
          <button className="app-signout" onClick={() => setTab("home")}>
            Sign in
          </button>
        )}
      </header>
      <a
        className="app-tf-banner"
        href={TESTFLIGHT_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        The iPhone app is the product — get TestFlight
      </a>
      <main className="app-main">
        {tab === "home" ? (
          <HomeSettingsTab user={user} onSignedIn={onSignedIn} onSignOut={onSignOut} />
        ) : null}
        {tab === "nearby" ? <NearbyTab /> : null}
        {tab === "identify" ? <IdentifyTab /> : null}
        {tab === "research" ? <ResearchChatTab /> : null}
        {tab === "saved" ? (
          user ? (
            <SavedTab />
          ) : (
            <SignedOutSaved onGoHome={() => setTab("home")} />
          )
        ) : null}
      </main>
    </div>
  );
}

function SignedOutSaved({ onGoHome }: { onGoHome: () => void }) {
  return (
    <div className="app-empty">
      <h2>Sign in to save tickers.</h2>
      <p>
        Your watchlist and memos are tied to your account. Nearby, Identify, and Research all work
        without one.
      </p>
      <button type="button" className="app-btn app-btn-primary" onClick={onGoHome}>
        Go to Home to sign in
      </button>
    </div>
  );
}

function HomeSettingsTab({
  user,
  onSignedIn,
  onSignOut,
}: {
  user: User | null;
  onSignedIn: (u: User) => void;
  onSignOut: () => void;
}) {
  if (!user) {
    return (
      <section className="app-panel" style={{ display: "grid", gap: 16 }}>
        <div>
          <h2>Home</h2>
          <p className="app-sub">Account · settings · integrations</p>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <p className="app-muted">
            Browsing as guest — Nearby, Identify, and Research all work without an account. Sign in
            to ★ Save tickers to a watchlist, save memos, and connect your Robinhood MCP key.
          </p>
        </div>
        <SignIn onSignedIn={onSignedIn} embedded />
        <PlanPanel />
      </section>
    );
  }
  return <SignedInHomeSettings user={user} onSignOut={onSignOut} />;
}

function SignedInHomeSettings({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [rh, setRh] = useState<Awaited<ReturnType<typeof fetchSettings>>["robinhoodMcp"] | null>(
    null,
  );
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ent, setEnt] = useState<EntitlementState | null>(null);

  useEffect(() => {
    void fetchSettings()
      .then((s) => {
        setRh(s.robinhoodMcp);
        setNote(s.note ?? null);
      })
      .catch((e) => setStatus(e instanceof Error ? e.message : "settings failed"));
    void fetchEntitlements()
      .then(setEnt)
      .catch(() => setEnt(null));
  }, []);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await saveRobinhoodMcp(token.trim());
      setRh(r.robinhoodMcp);
      setToken("");
      setStatus("Robinhood MCP key saved (masked on server)");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      const r = await clearRobinhoodMcp();
      setRh(r.robinhoodMcp);
      setStatus("Robinhood MCP key cleared");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "clear failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="app-panel" style={{ display: "grid", gap: 16 }}>
      <div>
        <h2>Home</h2>
        <p className="app-sub">Account · settings · Robinhood MCP</p>
      </div>
      <div>
        <div className="app-muted">Signed in</div>
        <div>{user.email}</div>
      </div>
      <PlanPanel initial={ent} />
      <div style={{ display: "grid", gap: 8 }}>
        <h3>Robinhood MCP</h3>
        <p className="app-muted">
          {note ??
            "Paste the bearer from your Robinhood agent / ChatGPT MCP connector. Stored server-side; only fingerprint is shown."}
        </p>
        {rh?.configured ? (
          <p>
            Configured · …{rh.last4} · fp {rh.fingerprint}
          </p>
        ) : (
          <p className="app-muted">Not configured</p>
        )}
        <input
          className="app-input"
          type="password"
          placeholder="Paste Robinhood MCP token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="app-btn" disabled={!token.trim() || busy} onClick={() => void save()}>
            Save key
          </button>
          {rh?.configured ? (
            <button className="app-btn secondary" disabled={busy} onClick={() => void clear()}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
      {status ? <p className="app-muted">{status}</p> : null}
      <button className="app-btn secondary" onClick={onSignOut}>
        Sign out
      </button>
    </section>
  );
}

function PlanPanel({ initial }: { initial?: EntitlementState | null }) {
  const { presentPaywall } = usePaywall();
  const [ent, setEnt] = useState<EntitlementState | null>(initial ?? null);

  useEffect(() => {
    if (initial) setEnt(initial);
  }, [initial]);

  useEffect(() => {
    if (initial) return;
    void fetchEntitlements()
      .then(setEnt)
      .catch(() => setEnt(null));
  }, [initial]);

  async function manage() {
    try {
      const { url } = await startPortal();
      window.location.href = url;
    } catch {
      presentPaywall();
    }
  }

  if (!ent) return null;
  const unlimited = ent.freeForever || ent.subscribed;
  const label = ent.freeForever
    ? "Free forever"
    : ent.subscribed
      ? "Mapvest Pro"
      : "Free tier";

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <h3>Plan</h3>
      <p>
        {label}
        {unlimited
          ? ". Unlimited identify, research, and memos."
          : `. ${ent.remaining} of ${ent.limit} free generations left. Identify, research, and memos count. Map and nearby stay free.`}
      </p>
      <p className="app-muted">Pro is $19.99/month. Research, not a brokerage, not investment advice.</p>
      {!unlimited ? (
        <button type="button" className="app-btn app-btn-primary" onClick={() => presentPaywall()}>
          Subscribe $19.99/mo
        </button>
      ) : ent.subscribed && !ent.freeForever ? (
        <button type="button" className="app-btn secondary" onClick={() => void manage()}>
          Manage subscription
        </button>
      ) : null}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`app-tab ${active ? "app-tab-active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

/* -------------------------- Nearby --------------------------- */

/** Demo pins when the browser won't share GPS (common on desktop Safari). */
const FALLBACK_LOCS: { label: string; lat: number; lng: number }[] = [
  { label: "Astoria, NY", lat: 40.7675, lng: -73.9309 },
  { label: "Times Square", lat: 40.758, lng: -73.9855 },
  { label: "SF Market St", lat: 37.7749, lng: -122.4194 },
];

function geoErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission denied. Allow location for this site, or pick a city below.";
    case err.POSITION_UNAVAILABLE:
      return "Couldn't get your GPS fix. Pick a city below, or retry.";
    case err.TIMEOUT:
      return "Location timed out. Pick a city below, or retry.";
    default:
      return err.message || "Location unavailable. Pick a city below.";
  }
}

function locateOnce(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported in this browser."));
      return;
    }
    // Low-accuracy first — high-accuracy + short timeout is what surfaces
    // Safari's "Position update is unavailable" on desktop / weak GPS.
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

type QuoteSnap = { price: number; change: number; changePct: number };

function NearbyTab() {
  const [items, setItems] = useState<NearbyItem[] | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteSnap>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);

  function useCoords(next: { lat: number; lng: number }, label?: string) {
    setErr(null);
    setItems(null);
    setPlaceLabel(label ?? null);
    setCoords(next);
  }

  async function requestLocation() {
    setLocating(true);
    setErr(null);
    try {
      const c = await locateOnce();
      useCoords(c, "Your location");
    } catch (e) {
      if (e && typeof e === "object" && "code" in e) {
        setErr(geoErrorMessage(e as GeolocationPositionError));
      } else {
        setErr(e instanceof Error ? e.message : "Location unavailable.");
      }
    } finally {
      setLocating(false);
    }
  }

  useEffect(() => {
    void requestLocation();
  }, []);

  useEffect(() => {
    if (!coords) return;
    setBusy(true);
    setErr(null);
    setQuotes({});
    fetchNearby(coords.lat, coords.lng, 1200, 25)
      .then(async (r) => {
        setItems(r.items);
        const tickers = r.items
          .map((it) => it.investable?.brand.ticker?.symbol)
          .filter((t): t is string => !!t)
          .slice(0, 12);
        const entries = await Promise.all(
          tickers.map(async (t) => {
            try {
              const q = await getQuote(t);
              return q.quote
                ? ([
                    t,
                    {
                      price: q.quote.price,
                      change: q.quote.change,
                      changePct: q.quote.changePct,
                    },
                  ] as const)
                : null;
            } catch {
              return null;
            }
          }),
        );
        const map: Record<string, QuoteSnap> = {};
        for (const e of entries) if (e) map[e[0]] = e[1];
        setQuotes(map);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "nearby failed"))
      .finally(() => setBusy(false));
  }, [coords]);

  if (err && !items) {
    return (
      <div className="app-empty">
        <p className="app-err">{err}</p>
        <div className="app-fallback-row">
          <button
            className="app-btn app-btn-primary"
            type="button"
            onClick={() => void requestLocation()}
          >
            Retry location
          </button>
          {FALLBACK_LOCS.map((loc) => (
            <button
              key={loc.label}
              className="app-btn"
              type="button"
              onClick={() => useCoords({ lat: loc.lat, lng: loc.lng }, loc.label)}
            >
              {loc.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (locating || busy || !items) {
    return (
      <p className="app-muted">{locating ? "Getting your location…" : "Loading nearby brands…"}</p>
    );
  }

  return (
    <div className="app-list">
      <p className="app-muted">
        {items.length} nearby
        {placeLabel ? ` · ${placeLabel}` : ""}
        {coords ? ` · ${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}` : ""}
        {" · "}
        <button className="app-link" type="button" onClick={() => void requestLocation()}>
          relocalize
        </button>
      </p>
      {items.map((it) => {
        const ticker = it.investable?.brand.ticker?.symbol;
        const q = ticker ? quotes[ticker] : undefined;
        return (
          <Link
            key={it.place.id}
            href={`/app/ticker/${encodeURIComponent(ticker ?? it.place.name)}`}
            className={`app-row ${ticker ? "app-row-public" : "app-row-private"}`}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="app-row-title">{it.place.name}</div>
              <div className="app-row-sub">
                {ticker ? (
                  <>
                    <span className="app-ticker">${ticker}</span> ·{" "}
                    {it.investable?.brand.sector ?? "—"}
                  </>
                ) : (
                  "no public ticker"
                )}
              </div>
            </div>
            {q ? (
              <div className="app-row-price">
                <div className="app-row-price-val">${q.price.toFixed(2)}</div>
                <div
                  className={`app-row-price-chg ${
                    q.change >= 0 ? "app-quote-up" : "app-quote-down"
                  }`}
                >
                  {q.change >= 0 ? "+" : ""}
                  {q.changePct.toFixed(2)}%
                </div>
              </div>
            ) : (
              <span className="app-chevron">›</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/* -------------------------- Identify --------------------------- */

function IdentifyTab() {
  const { presentPaywall } = usePaywall();
  const [result, setResult] = useState<Awaited<ReturnType<typeof identifyImage>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await identifyImage(file);
      setResult(r);
    } catch (er) {
      if (presentPaywallIfQuota(er, presentPaywall)) {
        setErr("Free generations used. Subscribe to keep identifying.");
        return;
      }
      setErr(er instanceof Error ? er.message : "identify failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-identify">
      <label className="app-upload">
        <input type="file" accept="image/*" capture="environment" onChange={onFile} />
        <span>Upload a photo → identify brand</span>
      </label>
      {preview ? <img src={preview} alt="preview" className="app-preview" /> : null}
      {busy ? <p className="app-muted">Analyzing…</p> : null}
      {err ? <p className="app-err">{err}</p> : null}
      {result?.investables.map((inv, i) => {
        const ticker = inv.brand.ticker?.symbol;
        const comps = (inv.comparables ?? [])
          .map((c) => c.ticker)
          .filter(Boolean)
          .slice(0, 3);
        const hrefTicker = ticker ?? comps[0] ?? inv.brand.name;
        return (
          <Link
            key={i}
            href={`/app/ticker/${encodeURIComponent(hrefTicker)}`}
            className={`app-row ${ticker || comps.length ? "app-row-public" : "app-row-private"}`}
          >
            <div>
              <div className="app-row-title">{inv.brand.name}</div>
              <div className="app-row-sub">
                {ticker ? (
                  <>
                    <span className="app-ticker">${ticker}</span> · {inv.brand.sector ?? "—"} ·
                    confidence {inv.confidence}
                  </>
                ) : comps.length > 0 ? (
                  <>
                    private · comps{" "}
                    {comps.map((t, idx) => (
                      <span key={t}>
                        {idx > 0 ? ", " : ""}
                        <span className="app-ticker">≈${t}</span>
                      </span>
                    ))}
                  </>
                ) : (
                  "no public ticker · confidence " + inv.confidence
                )}
              </div>
            </div>
            <span className="app-chevron">›</span>
          </Link>
        );
      })}
    </div>
  );
}

/* -------------------------- Research chat --------------------------- */

const ACTIVE_RESEARCH_CONVERSATION_KEY = "mapvest.research.activeConversationId.v1";

function persistActiveResearchConversation(conversationId?: string) {
  try {
    if (conversationId) {
      window.localStorage.setItem(ACTIVE_RESEARCH_CONVERSATION_KEY, conversationId);
    } else {
      window.localStorage.removeItem(ACTIVE_RESEARCH_CONVERSATION_KEY);
    }
  } catch {
    // The in-memory conversation id still preserves continuity for this tab.
  }
}

function ResearchChatTab() {
  const { presentPaywall } = usePaywall();
  const [threads, setThreads] = useState<AgentThread[] | null>(null);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [turns, setTurns] = useState<ResearchArticle[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "chat">("list");
  const retryRef = useRef<{ message: string; clientMessageId: string } | null>(null);

  useEffect(() => {
    let active = true;
    try {
      const persisted = window.localStorage.getItem(ACTIVE_RESEARCH_CONVERSATION_KEY);
      if (!persisted) return;
      setView("chat");
      setThreadId(persisted);
      getAgentThread(persisted)
        .then((response) => {
          if (active) setTurns(response.thread.messages ?? []);
        })
        .catch((error) => {
          if (active) {
            setThreadId(undefined);
            persistActiveResearchConversation();
            setErr(error instanceof Error ? error.message : "load failed");
          }
        });
    } catch {
      // Research remains usable when browser storage is unavailable.
    }
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (view !== "list") return;
    listAgentThreads()
      .then((r) => setThreads(r.threads))
      .catch((e) => setErr(e instanceof Error ? e.message : "failed"));
  }, [view]);

  async function openThread(id: string, title: string) {
    setView("chat");
    setThreadId(id);
    retryRef.current = null;
    persistActiveResearchConversation(id);
    setErr(null);
    try {
      const r = await getAgentThread(id);
      setTurns(r.thread.messages ?? []);
      void title;
    } catch (e) {
      setThreadId(undefined);
      persistActiveResearchConversation();
      setErr(e instanceof Error ? e.message : "load failed");
      setTurns([]);
    }
  }

  function newChat() {
    setView("chat");
    setThreadId(undefined);
    retryRef.current = null;
    persistActiveResearchConversation();
    setTurns([]);
    setInput("");
    setErr(null);
  }

  async function onSend() {
    const msg = input.trim();
    if (!msg || busy) return;
    const retry = retryRef.current;
    const clientMessageId =
      retry?.message === msg ? retry.clientMessageId : createAgentClientMessageId();
    const optimisticId = `u-${clientMessageId}`;
    setBusy(true);
    setErr(null);
    setTurns((turns) =>
      turns.some((turn) => turn.id === optimisticId)
        ? turns
        : [
            ...turns,
            {
              id: optimisticId,
              role: "user",
              content: msg,
              createdAt: new Date().toISOString(),
              interesting: [],
              ideas: [],
              toolsUsed: [],
              sources: [],
              chartTickers: [],
            },
          ],
    );
    setInput("");
    try {
      const r = await agentChat(msg, {
        conversationId: threadId,
        clientMessageId,
      });
      const conversationId = r.conversationId ?? r.threadId;
      if (conversationId) {
        setThreadId(conversationId);
        persistActiveResearchConversation(conversationId);
      }
      retryRef.current = null;
      setTurns((turns) =>
        turns.some((turn) => turn.id === r.article.id) ? turns : [...turns, r.article],
      );
    } catch (e) {
      retryRef.current = { message: msg, clientMessageId };
      setInput(msg);
      if (presentPaywallIfQuota(e, presentPaywall)) {
        setErr("Free generations used. Subscribe to keep researching.");
        return;
      }
      setErr(e instanceof Error ? e.message : "research failed");
    } finally {
      setBusy(false);
    }
  }

  if (view === "list") {
    return (
      <div className="app-chat">
        <div className="app-chat-head">
          <div>
            <h2 style={{ margin: 0, textTransform: "none", letterSpacing: 0, color: "var(--fg)" }}>
              Research
            </h2>
            <p className="app-muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
              Article-style briefs · tools run in the background · not investment advice
            </p>
          </div>
          <button type="button" className="app-btn app-btn-primary" onClick={newChat}>
            + New
          </button>
        </div>
        {err ? <p className="app-err">{err}</p> : null}
        {!threads ? (
          <p className="app-muted">Loading…</p>
        ) : threads.length === 0 ? (
          <div className="app-empty">
            <h2>No briefs yet</h2>
            <p>Start a chat, or open a ticker and tap Research…</p>
            <button type="button" className="app-btn app-btn-primary" onClick={newChat}>
              Start research
            </button>
          </div>
        ) : (
          threads.map((b) => (
            <button
              key={b.id}
              type="button"
              className="app-row app-row-public"
              style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
              onClick={() => void openThread(b.conversationId ?? b.id, b.title)}
            >
              <div style={{ flex: 1 }}>
                <div className="app-row-title">{b.title}</div>
                <div className="app-row-sub">{b.preview || "—"}</div>
              </div>
              <span className="app-chevron">›</span>
            </button>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="app-chat app-chat-active">
      <div className="app-chat-head">
        <button
          type="button"
          className="app-link"
          style={{ padding: 0 }}
          onClick={() => setView("list")}
        >
          ← Chats
        </button>
        <button type="button" className="app-btn" onClick={newChat}>
          New
        </button>
      </div>
      <div className="app-research-stream" style={{ flex: 1, maxHeight: "min(60vh, 640px)" }}>
        {turns.length === 0 ? (
          <p className="app-muted">Ask about a ticker or theme. Lede first, then evidence.</p>
        ) : null}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="app-research-q">
              {t.content}
            </div>
          ) : (
            <article key={t.id} className="app-article">
              <p className="app-article-lede">{t.content}</p>
              {t.interesting.slice(0, 4).map((x, i) => (
                <p key={i} className="app-muted">
                  · {x}
                </p>
              ))}
              {t.chartTickers.slice(0, 3).map((sym) => (
                <Link
                  key={sym}
                  href={`/app/ticker/${encodeURIComponent(sym)}`}
                  className="app-source-chip"
                >
                  ${sym}
                </Link>
              ))}
              {t.toolsUsed.length ? (
                <p className="app-article-tools">Tools · {t.toolsUsed.slice(0, 5).join(" · ")}</p>
              ) : null}
            </article>
          ),
        )}
        {busy ? <div className="app-chart-skel" aria-label="Researching…" /> : null}
        {err ? <p className="app-err">{err}</p> : null}
      </div>
      <div className="app-research-composer">
        <input
          className="app-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          placeholder="Ask Mapvest…"
          disabled={busy}
        />
        <button
          type="button"
          className="app-btn app-btn-primary"
          onClick={() => void onSend()}
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : "Ask"}
        </button>
      </div>
    </div>
  );
}

/* -------------------------- Saved --------------------------- */

function SavedTab() {
  const [segment, setSegment] = useState<"watchlist" | "briefs">("watchlist");
  const [items, setItems] = useState<WatchEntry[] | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteSnap>>({});
  const [briefs, setBriefs] = useState<AgentThread[] | null>(null);
  const [openBrief, setOpenBrief] = useState<AgentThread | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cockpit, setCockpit] = useState<CockpitRow[] | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [panelBusy, setPanelBusy] = useState<"" | "cockpit" | "alerts">("");
  const [panelErr, setPanelErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const r = await listWatchlist();
      setItems(r.items);
      const entries = await Promise.all(
        r.items.slice(0, 15).map(async (it) => {
          try {
            const q = await getQuote(it.ticker);
            return q.quote
              ? ([
                  it.ticker,
                  {
                    price: q.quote.price,
                    change: q.quote.change,
                    changePct: q.quote.changePct,
                  },
                ] as const)
              : null;
          } catch {
            return null;
          }
        }),
      );
      const map: Record<string, QuoteSnap> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      setQuotes(map);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (segment !== "briefs") return;
    setBriefs(null);
    listAgentThreads()
      .then((r) => setBriefs(r.threads))
      .catch((e) => setErr(e instanceof Error ? e.message : "briefs failed"));
  }, [segment]);

  async function onCockpit() {
    if (!items?.length) return;
    setPanelBusy("cockpit");
    setPanelErr(null);
    try {
      const r = await fetchCockpit(items.map((i) => i.ticker));
      setCockpit(r.rows);
      setAlerts(null);
    } catch (e) {
      setPanelErr(e instanceof Error ? e.message : "cockpit failed");
    } finally {
      setPanelBusy("");
    }
  }

  async function onAlerts() {
    if (!items?.length) return;
    setPanelBusy("alerts");
    setPanelErr(null);
    try {
      const r = await fetchAlerts(items.map((i) => i.ticker));
      setAlerts(r.alerts);
      setCockpit(null);
    } catch (e) {
      setPanelErr(e instanceof Error ? e.message : "alerts failed");
    } finally {
      setPanelBusy("");
    }
  }

  if (err && segment === "watchlist") return <p className="app-err">{err}</p>;
  if (segment === "watchlist" && !items) return <p className="app-muted">Loading…</p>;

  return (
    <div className="app-list">
      <div className="app-segment" role="tablist">
        <button
          type="button"
          className={segment === "watchlist" ? "app-segment-on" : ""}
          onClick={() => {
            setSegment("watchlist");
            setOpenBrief(null);
          }}
        >
          Watchlist
        </button>
        <button
          type="button"
          className={segment === "briefs" ? "app-segment-on" : ""}
          onClick={() => setSegment("briefs")}
        >
          Briefs
        </button>
      </div>

      {segment === "briefs" ? (
        openBrief ? (
          <div className="app-panel">
            <button
              type="button"
              className="app-link"
              style={{ textAlign: "left", padding: 0, marginBottom: "0.75rem" }}
              onClick={() => setOpenBrief(null)}
            >
              ← all briefs
            </button>
            <h2
              style={{
                textTransform: "none",
                letterSpacing: 0,
                color: "var(--fg)",
                fontSize: "1.1rem",
              }}
            >
              {openBrief.title}
            </h2>
            {(openBrief.messages ?? []).map((m) => (
              <div key={m.id} style={{ marginTop: "1rem" }}>
                {m.role === "user" ? (
                  <p className="app-research-q">{m.content}</p>
                ) : (
                  <article className="app-article">
                    <p className="app-article-lede">{m.content}</p>
                    {m.interesting?.slice(0, 4).map((x, i) => (
                      <p key={i} className="app-muted">
                        · {x}
                      </p>
                    ))}
                  </article>
                )}
              </div>
            ))}
          </div>
        ) : !briefs ? (
          <p className="app-muted">Loading briefs…</p>
        ) : briefs.length === 0 ? (
          <div className="app-empty">
            <h2>No research briefs yet.</h2>
            <p>Open a ticker and tap Research… — threads show up here.</p>
          </div>
        ) : (
          briefs.map((b) => (
            <button
              key={b.id}
              type="button"
              className="app-row app-row-public"
              style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
              onClick={() => {
                getAgentThread(b.id)
                  .then((r) => setOpenBrief(r.thread))
                  .catch((e) => setErr(e instanceof Error ? e.message : "load failed"));
              }}
            >
              <div style={{ flex: 1 }}>
                <div className="app-row-title">{b.title}</div>
                <div className="app-row-sub">{b.preview || "—"}</div>
              </div>
              <span className="app-chevron">›</span>
            </button>
          ))
        )
      ) : null}

      {segment === "watchlist" && items && items.length === 0 ? (
        <div className="app-empty">
          <h2>Nothing saved yet.</h2>
          <p>
            Open any ticker detail and tap ☆ Save. Use Research… for article-style briefs (see
            Briefs).
          </p>
        </div>
      ) : null}

      {segment === "watchlist" && items && items.length > 0 ? (
        <>
          <div className="app-action-row" style={{ marginBottom: "0.75rem" }}>
            <button
              type="button"
              className="app-btn"
              onClick={onCockpit}
              disabled={panelBusy === "cockpit"}
            >
              {panelBusy === "cockpit" ? "Cockpit…" : "Cockpit"}
            </button>
            <button
              type="button"
              className="app-btn"
              onClick={onAlerts}
              disabled={panelBusy === "alerts"}
            >
              {panelBusy === "alerts" ? "Alerts…" : "Alerts"}
            </button>
            <span className="app-muted" style={{ alignSelf: "center" }}>
              up to 10 · on demand
            </span>
          </div>
          {panelErr ? <p className="app-err">{panelErr}</p> : null}
          {cockpit ? (
            <section style={{ marginBottom: "1rem" }}>
              <h2>Cockpit</h2>
              <table className="app-cockpit-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Ticker</th>
                    <th>Lane</th>
                    <th>Score</th>
                    <th>Ridge</th>
                    <th>Flow</th>
                    <th>Auction</th>
                  </tr>
                </thead>
                <tbody>
                  {cockpit.map((r, i) => (
                    <tr key={`${r.ticker}-${i}`}>
                      <td>{r.rank ?? i + 1}</td>
                      <td>
                        <Link href={`/app/ticker/${encodeURIComponent(r.ticker)}`}>
                          <span className="app-ticker">${r.ticker}</span>
                        </Link>
                      </td>
                      <td>{r.lane ?? "—"}</td>
                      <td>{r.score != null ? (r.score.toFixed?.(2) ?? r.score) : "—"}</td>
                      <td>{r.ridge ?? "—"}</td>
                      <td>{r.flow ?? "—"}</td>
                      <td>{r.auction ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          {alerts ? (
            <section style={{ marginBottom: "1rem" }}>
              <h2>Alerts</h2>
              {alerts.length === 0 ? (
                <p className="app-muted">No alerts for this set.</p>
              ) : (
                <ul className="app-alert-list">
                  {alerts.map((a, i) => (
                    <li key={i}>
                      <strong>
                        {a.ticker ? `$${a.ticker}` : "—"}
                        {a.title ? ` · ${a.title}` : ""}
                      </strong>
                      <div className="app-muted">{a.summary ?? a.message ?? ""}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          {items.map((e) => {
            const q = quotes[e.ticker];
            return (
              <Link
                key={e.ticker}
                href={`/app/ticker/${encodeURIComponent(e.ticker)}`}
                className="app-row app-row-public"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="app-row-title">
                    <span className="app-ticker">${e.ticker}</span> {e.name ? `· ${e.name}` : ""}
                  </div>
                  <div className="app-row-sub">
                    {e.sector ?? "—"}
                    {e.memo ? (
                      <span className="app-memo-badge">
                        {" "}
                        · 📝 {e.memoProvider ?? "memo"} · {e.memo.length} chars
                      </span>
                    ) : null}
                  </div>
                </div>
                {q ? (
                  <div className="app-row-price">
                    <div className="app-row-price-val">${q.price.toFixed(2)}</div>
                    <div
                      className={`app-row-price-chg ${
                        q.change >= 0 ? "app-quote-up" : "app-quote-down"
                      }`}
                    >
                      {q.change >= 0 ? "+" : ""}
                      {q.changePct.toFixed(2)}%
                    </div>
                  </div>
                ) : (
                  <span className="app-chevron">›</span>
                )}
              </Link>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
