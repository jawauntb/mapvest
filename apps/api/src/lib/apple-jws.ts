/**
 * StoreKit 2 transaction JWS verification.
 *
 * Apple signs each transaction as ES256 with an x5c chain that must terminate
 * at Apple Root CA - G3 (public CA, not a secret). We pin that root and then
 * enforce bundleId / productId / subscription expiry ourselves.
 *
 * @see https://developer.apple.com/documentation/appstoreserverapi/validating-json-web-tokens
 * @see https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
 */
import { X509Certificate, createVerify } from "node:crypto";
import { appleBundleId, appleIapProductId, isDev } from "./env.js";

/** Public Apple Root CA - G3 (SHA-256 63:34:3A:BF:…:91:79). Expires 2039-04-30. */
export const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

export const APPLE_ROOT_CA_G3_FINGERPRINT_SHA256 =
  "63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79";

export class AppleJwsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppleJwsError";
  }
}

export type AppleTransaction = {
  bundleId: string;
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  expiresDate?: number;
  purchaseDate?: number;
  type?: string;
  environment?: string;
  revocationDate?: number;
};

type AppleJwsVerifier = (jws: string) => Promise<AppleTransaction>;

let testVerifier: AppleJwsVerifier | undefined;

/** Test-only. Production never calls this. */
export function __setAppleJwsVerifier(fn: AppleJwsVerifier | undefined): void {
  testVerifier = fn;
}

export async function verifyAppleSignedTransaction(jws: string): Promise<AppleTransaction> {
  if (testVerifier) return testVerifier(jws);
  return verifyAppleSignedTransactionLive(jws);
}

export function verifyAppleSignedTransactionLive(jws: string): AppleTransaction {
  const parts = jws.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    throw new AppleJwsError("malformed jws");
  }
  const [h, p, s] = parts;
  let header: { alg?: string; x5c?: string[] };
  try {
    header = JSON.parse(b64urlToUtf8(h)) as { alg?: string; x5c?: string[] };
  } catch {
    throw new AppleJwsError("malformed jws header");
  }
  if (header.alg !== "ES256" || !header.x5c?.length) {
    throw new AppleJwsError("unsupported jws header");
  }

  const certs = header.x5c.map((der) => {
    try {
      return new X509Certificate(Buffer.from(der, "base64"));
    } catch {
      throw new AppleJwsError("untrusted cert chain");
    }
  });
  verifyX5cChain(certs, new X509Certificate(APPLE_ROOT_CA_G3_PEM));

  const signature = b64urlToBuf(s);
  const verifier = createVerify("SHA256");
  verifier.update(`${h}.${p}`);
  const ok = verifier.verify({ key: certs[0].publicKey, dsaEncoding: "ieee-p1363" }, signature);
  if (!ok) throw new AppleJwsError("bad signature");

  try {
    return JSON.parse(b64urlToUtf8(p)) as AppleTransaction;
  } catch {
    throw new AppleJwsError("malformed jws payload");
  }
}

function verifyX5cChain(certs: X509Certificate[], root: X509Certificate): void {
  const now = new Date();
  const rootFp = normalizeFp(root.fingerprint256);
  if (rootFp !== APPLE_ROOT_CA_G3_FINGERPRINT_SHA256) {
    throw new AppleJwsError("untrusted cert chain");
  }
  for (const cert of certs) {
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
      throw new AppleJwsError("expired cert");
    }
  }
  if (now < new Date(root.validFrom) || now > new Date(root.validTo)) {
    throw new AppleJwsError("expired cert");
  }

  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];
    if (normalizeFp(cert.fingerprint256) === rootFp) {
      if (i !== certs.length - 1) throw new AppleJwsError("untrusted cert chain");
      continue;
    }
    const issuer = i + 1 < certs.length ? certs[i + 1] : root;
    const issuerKey =
      normalizeFp(issuer.fingerprint256) === rootFp ? root.publicKey : issuer.publicKey;
    if (!cert.checkIssued(issuer) || !cert.verify(issuerKey)) {
      throw new AppleJwsError("untrusted cert chain");
    }
  }
}

export function assertAppleSubscription(tx: AppleTransaction, now = Date.now()): AppleTransaction {
  const bundleId = appleBundleId();
  const productId = appleIapProductId() ?? "mapvest_pro_monthly";
  if (tx.bundleId !== bundleId) throw new AppleJwsError("bundle mismatch");
  if (tx.productId !== productId) throw new AppleJwsError("product mismatch");
  if (!tx.originalTransactionId || !tx.transactionId) {
    throw new AppleJwsError("missing transaction id");
  }
  if (tx.type && tx.type !== "Auto-Renewable Subscription") {
    throw new AppleJwsError("not a subscription");
  }
  const env = tx.environment;
  if (env === "Xcode" && !isDev()) throw new AppleJwsError("xcode storekit not allowed");
  if (env && env !== "Sandbox" && env !== "Production" && env !== "Xcode") {
    throw new AppleJwsError("unknown environment");
  }
  if (tx.revocationDate) throw new AppleJwsError("revoked");
  if (typeof tx.expiresDate === "number" && tx.expiresDate <= now) {
    throw new AppleJwsError("expired");
  }
  return tx;
}

function normalizeFp(fp: string): string {
  return fp.replace(/[a-f]/g, (c) => c.toUpperCase());
}

function b64urlToBuf(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4;
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad), "base64");
}

function b64urlToUtf8(s: string): string {
  return b64urlToBuf(s).toString("utf8");
}
