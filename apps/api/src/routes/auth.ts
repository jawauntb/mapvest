import type { Session, User } from "@mapvest/core";
import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { z } from "zod";
import { isDev, sessionSigningKey } from "../lib/env.js";
import { consumePendingLink, findOrCreateUserByEmail, storePendingLink } from "../lib/store.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

const auth = new Hono<AuthEnv>();

const MAGIC_LINK_TTL_SEC = 10 * 60; // 10 min
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

const RequestMagicLinkBody = z.object({
  email: z.string().email(),
});

const VerifyBody = z.object({
  token: z.string().min(10),
});

/**
 * POST /v1/auth/request-magic-link
 * Body: { email }
 * Creates a signed magic-link JWT, stores a pending session keyed by jti,
 * returns { sent: true }. In dev also logs the magic link to stdout so
 * you can copy it out of the terminal.
 */
auth.post("/request-magic-link", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = RequestMagicLinkBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "email required" }, 400);
  const { email } = parsed.data;

  const jti = crypto.randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    purpose: "magic" as const,
    email: email.toLowerCase(),
    jti,
    iat: nowSec,
    exp: nowSec + MAGIC_LINK_TTL_SEC,
  };
  const token = await sign(payload, sessionSigningKey());
  storePendingLink(jti, {
    email: email.toLowerCase(),
    token,
    expiresAt: Date.now() + MAGIC_LINK_TTL_SEC * 1000,
  });

  if (isDev()) {
    const baseUrl = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
    console.log(`[auth] magic link for ${email}: ${baseUrl}/v1/auth/verify?token=${token}`);
  }

  return c.json({ sent: true });
});

/**
 * POST /v1/auth/verify
 * Body: { token }
 * Validates the magic-link JWT, consumes it, upserts the user, and returns a
 * long-lived session JWT.
 */
auth.post("/verify", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = VerifyBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "token required" }, 400);
  const { token } = parsed.data;

  let payload: Record<string, unknown>;
  try {
    payload = (await verify(token, sessionSigningKey(), "HS256")) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid or expired token" }, 401);
  }
  if (payload.purpose !== "magic") {
    return c.json({ error: "wrong token purpose" }, 401);
  }
  const jti = typeof payload.jti === "string" ? payload.jti : undefined;
  const email = typeof payload.email === "string" ? payload.email : undefined;
  if (!jti || !email) return c.json({ error: "malformed token" }, 401);

  const pending = consumePendingLink(jti);
  if (!pending) return c.json({ error: "token already used or expired" }, 401);
  if (pending.email !== email) return c.json({ error: "token mismatch" }, 401);

  const user: User = await findOrCreateUserByEmail(email);

  const nowSec = Math.floor(Date.now() / 1000);
  const sessionPayload = {
    purpose: "session" as const,
    sub: user.id,
    email: user.email,
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SEC,
  };
  const sessionJwt = await sign(sessionPayload, sessionSigningKey());
  const session: Session = {
    token: sessionJwt,
    userId: user.id,
    expiresAt: new Date((nowSec + SESSION_TTL_SEC) * 1000).toISOString(),
  };
  return c.json({ session });
});

/**
 * GET /v1/auth/me
 * Auth: Bearer <session.token>
 * Returns the authenticated user.
 */
auth.get("/me", bearerAuth, (c) => {
  const user = c.get("user");
  return c.json({ user });
});

/* ==========================================================================
 * OTP-code flow — matches what the iOS client actually calls (/v1/auth/session
 * + /v1/auth/session/verify with {email, code}). Kept alongside the
 * magic-link/token flow above so both shapes work.
 *
 * v0.1: no SMTP wired, so the response includes `devCode` when
 * AUTH_RETURN_CODE=1 (Doppler flag). The iOS auth screen surfaces it inline
 * for demo submissions; prod turns it off once email/SMS lands.
 * ========================================================================== */

const SessionRequestBody = z.object({ email: z.string().email() });
const SessionVerifyBody = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{4,8}$/),
});

// In-memory code store: email → { code, expiresAt }. Same 10-min TTL as magic
// links. Multi-instance deploys will need Redis, tracked in D11.
const codeStore = new Map<string, { code: string; expiresAt: number }>();

function newCode(): string {
  // 6-digit, zero-padded, cryptographically random.
  const n = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * POST /v1/auth/session
 * Body: { email }
 * Issues a 6-digit code, stores it against the email with a 10-min TTL, and
 * (in v0.1) returns it in the response body when AUTH_RETURN_CODE=1 so the
 * demo can complete without a real email pipeline.
 */
auth.post("/session", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = SessionRequestBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "email required" }, 400);
  const email = parsed.data.email.toLowerCase();
  const code = newCode();
  codeStore.set(email, { code, expiresAt: Date.now() + MAGIC_LINK_TTL_SEC * 1000 });
  console.log(`[auth] session code for ${email}: ${code}`);
  const body: { sent: true; devCode?: string } = { sent: true };
  if (process.env.AUTH_RETURN_CODE === "1" || isDev()) body.devCode = code;
  return c.json(body);
});

/**
 * POST /v1/auth/session/verify
 * Body: { email, code }
 * Consumes the code (single-use), upserts the user, returns { session, user }.
 */
auth.post("/session/verify", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = SessionVerifyBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "email + 6-digit code required" }, 400);
  const email = parsed.data.email.toLowerCase();
  const code = parsed.data.code;

  const entry = codeStore.get(email);
  if (!entry) return c.json({ error: "no code issued for that email" }, 401);
  if (entry.expiresAt <= Date.now()) {
    codeStore.delete(email);
    return c.json({ error: "code expired" }, 401);
  }
  if (entry.code !== code) return c.json({ error: "wrong code" }, 401);
  codeStore.delete(email); // single-use

  const user: User = await findOrCreateUserByEmail(email);
  const nowSec = Math.floor(Date.now() / 1000);
  const sessionJwt = await sign(
    {
      purpose: "session" as const,
      sub: user.id,
      email: user.email,
      iat: nowSec,
      exp: nowSec + SESSION_TTL_SEC,
    },
    sessionSigningKey(),
  );
  const session: Session = {
    token: sessionJwt,
    userId: user.id,
    expiresAt: new Date((nowSec + SESSION_TTL_SEC) * 1000).toISOString(),
  };
  return c.json({ session, user });
});

export default auth;
