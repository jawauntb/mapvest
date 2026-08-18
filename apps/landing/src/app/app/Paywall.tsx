"use client";

import { getToken, isQuotaExceeded, startCheckout, startPortal } from "@/lib/mapvest-api";
import { useRouter } from "next/navigation";
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

type PaywallCtx = { presentPaywall: () => void };

const Ctx = createContext<PaywallCtx | null>(null);

export function usePaywall(): PaywallCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePaywall must be used inside <PaywallRoot>");
  return v;
}

export function presentPaywallIfQuota(err: unknown, present: () => void): boolean {
  if (!isQuotaExceeded(err)) return false;
  present();
  return true;
}

export function PaywallRoot({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const presentPaywall = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ presentPaywall }), [presentPaywall]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <PaywallModal open={open} onClose={() => setOpen(false)} />
    </Ctx.Provider>
  );
}

function PaywallModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const signedIn = typeof window !== "undefined" && !!getToken();

  const subscribe = useCallback(async () => {
    setErr(null);
    if (!getToken()) {
      onClose();
      router.push("/app");
      return;
    }
    setBusy(true);
    try {
      const intent = await startCheckout("web");
      if (intent.channel === "stripe" && intent.url) {
        window.location.href = intent.url;
        return;
      }
      setErr("Could not start checkout for this platform.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start checkout.");
    } finally {
      setBusy(false);
    }
  }, [onClose, router]);

  const manage = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const { url } = await startPortal();
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open billing portal.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (!open) return null;

  return (
    <dialog className="paywall-scrim" open aria-label="Subscribe to Mapvest Pro">
      <div className="paywall-card">
        <p className="paywall-kicker">Mapvest Pro</p>
        <h2>50 free generations used</h2>
        <p>
          Identify, research briefs, and memos are metered. Map and nearby stay free. Pro is
          $20/month and follows the account you sign in with.
        </p>
        <p>
          This is research, not a brokerage, and not investment advice. Mapvest never places trades.
        </p>
        <button
          type="button"
          className="app-btn app-btn-primary"
          disabled={busy}
          onClick={() => void subscribe()}
        >
          {signedIn ? (busy ? "Opening checkout…" : "Subscribe $20/mo") : "Sign in to subscribe"}
        </button>
        {signedIn ? (
          <button type="button" className="app-link" disabled={busy} onClick={() => void manage()}>
            Already subscribed? Manage
          </button>
        ) : null}
        {err ? <p className="app-err">{err}</p> : null}
        <button type="button" className="app-link" onClick={onClose}>
          Not now. Map stays free.
        </button>
      </div>
    </dialog>
  );
}
