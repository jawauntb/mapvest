import { createInterface } from "node:readline/promises";
import {
  SchwabReadOnlyClient,
  authorizeUrl,
  exchangeAuthCode,
  maskAccountNumber,
} from "./schwab/client.js";

// Interactive Schwab login. Run on your laptop whenever the 7-day refresh token is due:
//   doppler run --project mapvest --config prd_portfolio_alerts -- \
//     bun run auth -- --doppler mapvest/prd_portfolio_alerts
// --doppler <project>/<config>  write the new token into Doppler (values go over stdin, never argv)
// --print                       print the token instead (for a manual paste)

export function codeFromRedirect(pasted: string): string {
  const trimmed = pasted.trim();
  const code = /^https?:\/\//.test(trimmed) ? new URL(trimmed).searchParams.get("code") : trimmed;
  if (!code)
    throw new Error("No ?code= in that URL. Paste the full address bar after the redirect.");
  return code;
}

async function dopplerSet(target: string, name: string, value: string) {
  const [project, config] = target.split("/");
  if (!project || !config) throw new Error("--doppler expects <project>/<config>");
  const proc = Bun.spawn(
    ["doppler", "secrets", "set", name, "--project", project, "--config", config, "--silent"],
    { stdin: new TextEncoder().encode(value), stdout: "inherit", stderr: "inherit" },
  );
  if ((await proc.exited) !== 0) throw new Error(`doppler secrets set ${name} failed`);
}

async function main() {
  const argv = process.argv.slice(2);
  const dopplerIdx = argv.indexOf("--doppler");
  const doppler = dopplerIdx >= 0 ? argv[dopplerIdx + 1] : undefined;
  const print = argv.includes("--print");
  if (!doppler && !print) {
    throw new Error("Pass --doppler <project>/<config> (recommended) or --print.");
  }

  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;
  const redirectUri = process.env.SCHWAB_CALLBACK_URL?.trim() || "https://127.0.0.1";
  if (!appKey || !appSecret) throw new Error("SCHWAB_APP_KEY and SCHWAB_APP_SECRET must be set.");

  console.log("1. Open this URL, log in to Schwab, and approve the account(s):\n");
  console.log(`   ${authorizeUrl(appKey, redirectUri)}\n`);
  console.log(
    `2. The browser lands on ${redirectUri}/?code=... (the page won't load; that's expected).`,
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = await rl.question("3. Paste that whole URL here: ");
  rl.close();

  const tokens = await exchangeAuthCode(
    { appKey, appSecret, code: codeFromRedirect(pasted), redirectUri },
    fetch,
  );
  if (!tokens.refresh_token) throw new Error("Schwab did not return a refresh token.");
  const issuedAt = new Date().toISOString();

  const accounts = await new SchwabReadOnlyClient(tokens.access_token).accountNumbers();
  console.log("\nLinked accounts:");
  for (const a of accounts)
    console.log(`  ${maskAccountNumber(a.accountNumber)}  hash ${a.hashValue}`);

  if (doppler) {
    await dopplerSet(doppler, "SCHWAB_REFRESH_TOKEN", tokens.refresh_token);
    await dopplerSet(doppler, "SCHWAB_REFRESH_TOKEN_ISSUED_AT", issuedAt);
    if (accounts.length === 1 && accounts[0] && !process.env.SCHWAB_ACCOUNT_HASH) {
      await dopplerSet(doppler, "SCHWAB_ACCOUNT_HASH", accounts[0].hashValue);
    }
    console.log(
      `\nSaved to Doppler ${doppler}. Good until ${new Date(Date.now() + 7 * 86_400_000).toLocaleString()}.`,
    );
    if (accounts.length > 1 && !process.env.SCHWAB_ACCOUNT_HASH) {
      console.log("More than one account: set SCHWAB_ACCOUNT_HASH in Doppler to the hash above.");
    }
  } else {
    console.log(`\nSCHWAB_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`SCHWAB_REFRESH_TOKEN_ISSUED_AT=${issuedAt}`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
