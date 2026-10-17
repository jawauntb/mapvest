import type { Channel } from "./config.js";

export type Message = {
  subject: string;
  text: string; // email body (plain)
  html: string;
  sms: string;
  channels: Channel[];
};

export interface Notifier {
  send(
    message: Message,
  ): Promise<{ sent: Channel[]; failed: { channel: Channel; error: string }[] }>;
}

type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;

async function resendEmail(
  env: Env,
  fetchImpl: Fetch,
  to: string,
  subject: string,
  text: string,
  html?: string,
) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.ALERT_EMAIL_FROM, to: [to], subject, text, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
}

async function twilioSms(env: Env, fetchImpl: Fetch, body: string) {
  const sid = env.TWILIO_ACCOUNT_SID ?? "";
  const res = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${env.TWILIO_AUTH_TOKEN}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: env.ALERT_SMS_TO ?? "",
        From: env.TWILIO_FROM_NUMBER ?? "",
        Body: body,
      }),
    },
  );
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text().catch(() => "")}`);
}

export type SmsMode = "twilio" | "email_gateway" | "none";

export function smsMode(env: Env): SmsMode {
  if (
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_FROM_NUMBER &&
    env.ALERT_SMS_TO
  ) {
    return "twilio";
  }
  if (env.ALERT_SMS_GATEWAY_EMAIL && env.RESEND_API_KEY && env.ALERT_EMAIL_FROM)
    return "email_gateway";
  return "none";
}

/** Resend for email; Twilio for SMS, or a carrier email-to-SMS address sent through Resend. */
export function liveNotifier(env: Env, fetchImpl: Fetch = fetch): Notifier {
  return {
    async send(message) {
      const sent: Channel[] = [];
      const failed: { channel: Channel; error: string }[] = [];
      for (const channel of message.channels) {
        try {
          if (channel === "email") {
            if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_FROM || !env.ALERT_EMAIL_TO) {
              throw new Error(
                "email not configured (RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO)",
              );
            }
            await resendEmail(
              env,
              fetchImpl,
              env.ALERT_EMAIL_TO,
              message.subject,
              message.text,
              message.html,
            );
          } else {
            const mode = smsMode(env);
            if (mode === "twilio") await twilioSms(env, fetchImpl, message.sms);
            else if (mode === "email_gateway") {
              // Carrier gateways drop long or HTML mail; send the SMS text as a bare plain email.
              await resendEmail(
                env,
                fetchImpl,
                env.ALERT_SMS_GATEWAY_EMAIL ?? "",
                "Portfolio",
                message.sms,
              );
            } else throw new Error("sms not configured (Twilio vars or ALERT_SMS_GATEWAY_EMAIL)");
          }
          sent.push(channel);
        } catch (err) {
          failed.push({ channel, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { sent, failed };
    },
  };
}

/** --dry-run: print instead of sending. */
export function consoleNotifier(log: (line: string) => void = console.log): Notifier {
  return {
    async send(message) {
      log(`--- [${message.channels.join("+")}] ${message.subject}`);
      log(message.text);
      log(`--- sms (${message.sms.length} chars): ${message.sms}`);
      return { sent: message.channels, failed: [] };
    },
  };
}
