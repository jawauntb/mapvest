"use client";

import {
  type NearbyItem,
  type User,
  type WatchEntry,
  addToWatchlist,
  clearSession,
  fetchNearby,
  generateMemo,
  getToken,
  getUser,
  identifyImage,
  listWatchlist,
  removeFromWatchlist,
  requestCode,
  saveMemoToWatchlist,
  setSession as saveSession,
  verifyCode,
} from "@/lib/mapvest-api";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AppPage() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(getUser());
    setReady(true);
  }, []);

  if (!ready) return <div className="app-loading">…</div>;
  if (!user) return <SignIn onSignedIn={setUser} />;

  return (
    <Home
      user={user}
      onSignOut={() => {
        clearSession();
        setUser(null);
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */

function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }) {
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
    <div className="app-signin">
      <h1>Mapvest</h1>
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

type Tab = "nearby" | "identify" | "saved";

function Home({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("nearby");

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-brand">Mapvest</div>
        <nav className="app-tabs">
          <TabBtn active={tab === "nearby"} onClick={() => setTab("nearby")}>
            Nearby
          </TabBtn>
          <TabBtn active={tab === "identify"} onClick={() => setTab("identify")}>
            Identify
          </TabBtn>
          <TabBtn active={tab === "saved"} onClick={() => setTab("saved")}>
            ★ Saved
          </TabBtn>
        </nav>
        <button className="app-signout" onClick={onSignOut}>
          {user.email} · sign out
        </button>
      </header>
      <main className="app-main">
        {tab === "nearby" ? <NearbyTab /> : null}
        {tab === "identify" ? <IdentifyTab /> : null}
        {tab === "saved" ? <SavedTab /> : null}
      </main>
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

function NearbyTab() {
  const [items, setItems] = useState<NearbyItem[] | null>(null);
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
    fetchNearby(coords.lat, coords.lng, 500, 25)
      .then((r) => setItems(r.items))
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
        return (
          <Link
            key={it.place.id}
            href={`/app/ticker/${encodeURIComponent(ticker ?? it.place.name)}`}
            className={`app-row ${ticker ? "app-row-public" : "app-row-private"}`}
          >
            <div>
              <div className="app-row-title">{it.place.name}</div>
              <div className="app-row-sub">
                {ticker ? (
                  <>
                    <span className="app-ticker">{ticker}</span> ·{" "}
                    {it.investable?.brand.sector ?? "—"}
                  </>
                ) : (
                  "no public ticker"
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

/* -------------------------- Identify --------------------------- */

function IdentifyTab() {
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

/* -------------------------- Saved --------------------------- */

function SavedTab() {
  const [items, setItems] = useState<WatchEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const r = await listWatchlist();
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (err) return <p className="app-err">{err}</p>;
  if (!items) return <p className="app-muted">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="app-empty">
        <h2>Nothing saved yet.</h2>
        <p>
          Open any ticker detail and tap ☆ Save. Generate a memo with 📝 and hit Save memo to keep
          it.
        </p>
      </div>
    );
  }

  return (
    <div className="app-list">
      {items.map((e) => (
        <Link
          key={e.ticker}
          href={`/app/ticker/${encodeURIComponent(e.ticker)}`}
          className="app-row app-row-public"
        >
          <div>
            <div className="app-row-title">
              <span className="app-ticker">{e.ticker}</span> {e.name ? `· ${e.name}` : ""}
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
          <span className="app-chevron">›</span>
        </Link>
      ))}
    </div>
  );
}
