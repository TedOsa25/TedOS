// Provider-agnostic SENDING LAYER for the Revenue Engine — PREPARED, NOT ACTIVE.
//
// Nothing here sends anything by default. Two independent safety gates must BOTH
// be satisfied before a single real email can leave the building:
//
//   1. REVENUE_SEND_ENABLED=1          — the global master switch (default: off).
//   2. a configured provider           — the selected provider has its credentials.
//
// The DEFAULT provider is "revenue-center": it NEVER sends — it only marks the
// email as pending manual approval. Real providers (Brevo · Mailjet · SES · SMTP)
// are wired behind the same interface so you can switch with one env var later,
// but every one of them refuses to send while the master switch is off.
//
//   REVENUE_EMAIL_PROVIDER = revenue-center | brevo | mailjet | ses | smtp
//   REVENUE_SEND_ENABLED   = 1   (arm the layer — otherwise everything is dry-run)
//
// This module is standalone: the engine's run()/export never calls it, so
// preparing the batch cannot trigger a send.

/** The email to deliver (already fully rendered by the template). */
export interface OutboundEmail {
  to: string;
  toName?: string;
  from: string;
  fromName?: string;
  replyTo?: string;
  /** Blind carbon copy — hidden from the recipient (true BCC, never a CC). */
  bcc?: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  tags?: string[];
}

export type ProviderName = "revenue-center" | "brevo" | "mailjet" | "ses" | "smtp";

export type SendStatus =
  | "sent" // actually delivered to the provider
  | "queued" // handed to manual approval (revenue-center) — not sent
  | "skipped" // dry-run: master switch off or provider not configured
  | "error"; // attempted but failed

export interface SendResult {
  provider: ProviderName;
  status: SendStatus;
  ok: boolean; // true for sent/queued/skipped, false for error
  messageId?: string;
  detail?: string;
}

export interface EmailProvider {
  readonly name: ProviderName;
  /** Human label for the Revenue Center provider picker. */
  readonly label: string;
  /** True when this provider has every credential it needs to send. */
  isConfigured(): boolean;
  /** Deliver one email. MUST return "skipped" unless armed AND configured. */
  send(email: OutboundEmail): Promise<SendResult>;
}

/** The global master switch. Off by default — the layer is inert until armed. */
export function isSendArmed(): boolean {
  return process.env.REVENUE_SEND_ENABLED === "1";
}

const ok = (provider: ProviderName, status: SendStatus, extra: Partial<SendResult> = {}): SendResult =>
  ({ provider, status, ok: status !== "error", ...extra });

/** Guard shared by all REAL providers: refuse to send unless armed + configured. */
function preflight(p: EmailProvider): SendResult | null {
  if (!isSendArmed()) return ok(p.name, "skipped", { detail: "master switch off (REVENUE_SEND_ENABLED != 1) — dry-run" });
  if (!p.isConfigured()) return ok(p.name, "skipped", { detail: `${p.name}: missing credentials — not sent` });
  return null;
}

// ── Providers ─────────────────────────────────────────────────────────────────

/** DEFAULT — never sends; routes to manual approval in the Revenue Center. */
const revenueCenter: EmailProvider = {
  name: "revenue-center",
  label: "Revenue Center (manuelle Freigabe)",
  isConfigured: () => true,
  async send() {
    return ok("revenue-center", "queued", { detail: "pending manual approval in the Revenue Center — nothing sent" });
  },
};

/** Brevo (transactional API v3). https://api.brevo.com/v3/smtp/email */
const brevo: EmailProvider = {
  name: "brevo",
  label: "Brevo",
  isConfigured: () => !!process.env.BREVO_API_KEY,
  async send(email) {
    const pre = preflight(brevo);
    if (pre) return pre;
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY as string, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: email.from, name: email.fromName },
          to: [{ email: email.to, name: email.toName }],
          ...(email.bcc ? { bcc: [{ email: email.bcc }] } : {}),
          ...(email.replyTo ? { replyTo: { email: email.replyTo } } : {}),
          subject: email.subject,
          htmlContent: email.html,
          ...(email.text ? { textContent: email.text } : {}),
          ...(email.headers ? { headers: email.headers } : {}),
          ...(email.tags ? { tags: email.tags } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
      return res.ok
        ? ok("brevo", "sent", body.messageId ? { messageId: body.messageId } : {})
        : ok("brevo", "error", { detail: `Brevo ${res.status}: ${body.message ?? "unknown"}` });
    } catch (e) {
      return ok("brevo", "error", { detail: `Brevo request failed: ${(e as Error).message}` });
    }
  },
};

/** Mailjet (Send API v3.1). https://api.mailjet.com/v3.1/send */
const mailjet: EmailProvider = {
  name: "mailjet",
  label: "Mailjet",
  isConfigured: () => !!process.env.MJ_APIKEY_PUBLIC && !!process.env.MJ_APIKEY_PRIVATE,
  async send(email) {
    const pre = preflight(mailjet);
    if (pre) return pre;
    try {
      const auth = Buffer.from(`${process.env.MJ_APIKEY_PUBLIC}:${process.env.MJ_APIKEY_PRIVATE}`).toString("base64");
      const res = await fetch("https://api.mailjet.com/v3.1/send", {
        method: "POST",
        headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
        body: JSON.stringify({
          Messages: [{
            From: { Email: email.from, Name: email.fromName },
            To: [{ Email: email.to, Name: email.toName }],
            ...(email.bcc ? { Bcc: [{ Email: email.bcc }] } : {}),
            ...(email.replyTo ? { ReplyTo: { Email: email.replyTo } } : {}),
            Subject: email.subject,
            HTMLPart: email.html,
            ...(email.text ? { TextPart: email.text } : {}),
            ...(email.headers ? { Headers: email.headers } : {}),
          }],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { Messages?: { Status?: string; To?: { MessageID?: string }[] }[]; ErrorMessage?: string };
      const msg = body.Messages?.[0];
      const mid = msg?.To?.[0]?.MessageID;
      return res.ok && msg?.Status === "success"
        ? ok("mailjet", "sent", mid ? { messageId: mid } : {})
        : ok("mailjet", "error", { detail: `Mailjet ${res.status}: ${body.ErrorMessage ?? msg?.Status ?? "unknown"}` });
    } catch (e) {
      return ok("mailjet", "error", { detail: `Mailjet request failed: ${(e as Error).message}` });
    }
  },
};

/** Amazon SES (optional). Skeleton — SigV4 signing intentionally left for wiring. */
const ses: EmailProvider = {
  name: "ses",
  label: "Amazon SES (optional)",
  isConfigured: () => !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY && !!process.env.AWS_REGION,
  async send() {
    const pre = preflight(ses);
    if (pre) return pre;
    // Prepared but deliberately not wired: SES needs SigV4-signed requests (or the
    // AWS SDK). Add that here when SES is chosen — the interface is already correct.
    return ok("ses", "error", { detail: "SES adapter not wired yet — choose Brevo/Mailjet/SMTP, or add SigV4 signing here" });
  },
};

/** Generic SMTP (via nodemailer, lazy-imported so it isn't a hard dependency). */
const smtp: EmailProvider = {
  name: "smtp",
  label: "SMTP",
  isConfigured: () => !!process.env.SMTP_HOST && !!process.env.SMTP_PORT && !!process.env.SMTP_USER && !!process.env.SMTP_PASS,
  async send(email) {
    const pre = preflight(smtp);
    if (pre) return pre;
    try {
      // Lazy import via an indirect specifier so 'nodemailer' stays an OPTIONAL
      // runtime dependency (no compile-time resolution, no hard dep in package.json).
      const mod = "nodemailer";
      const nodemailer = (await import(mod).catch(() => null)) as any;
      if (!nodemailer) return ok("smtp", "error", { detail: "SMTP selected but 'nodemailer' is not installed (npm i nodemailer)" });
      // Transport options mirror the proven send:test path exactly (secure/port,
      // STARTTLS requirement at 587, single-connection, timeouts).
      const secure = process.env.SMTP_SECURE === "1";
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? (secure ? 465 : 587)),
        secure,
        requireTLS: !secure,
        auth: { user: process.env.SMTP_USER as string, pass: process.env.SMTP_PASS as string },
        pool: false,
        maxConnections: 1,
        maxMessages: 1,
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
      });
      const info = await transport.sendMail({
        from: email.fromName ? `${email.fromName} <${email.from}>` : email.from,
        to: email.toName ? `${email.toName} <${email.to}>` : email.to,
        ...(email.bcc ? { bcc: email.bcc } : {}),
        ...(email.replyTo ? { replyTo: email.replyTo } : {}),
        subject: email.subject,
        html: email.html,
        ...(email.text ? { text: email.text } : {}),
        ...(email.headers ? { headers: email.headers } : {}),
      });
      return ok("smtp", "sent", { messageId: info.messageId });
    } catch (e) {
      return ok("smtp", "error", { detail: `SMTP send failed: ${(e as Error).message}` });
    }
  },
};

const PROVIDERS: Record<ProviderName, EmailProvider> = {
  "revenue-center": revenueCenter,
  brevo,
  mailjet,
  ses,
  smtp,
};

/** The safe default: manual approval, never sends. */
export const DEFAULT_PROVIDER: ProviderName = "revenue-center";

/** All selectable providers with their live readiness (for the Revenue Center UI). */
export function providerStatus(): { name: ProviderName; label: string; configured: boolean; selected: boolean }[] {
  const selected = selectedProviderName();
  return (Object.keys(PROVIDERS) as ProviderName[]).map((name) => ({
    name,
    label: PROVIDERS[name].label,
    configured: PROVIDERS[name].isConfigured(),
    selected: name === selected,
  }));
}

/** The currently selected provider name (env-driven, default = revenue-center). */
export function selectedProviderName(): ProviderName {
  const n = process.env.REVENUE_EMAIL_PROVIDER as ProviderName | undefined;
  return n && PROVIDERS[n] ? n : DEFAULT_PROVIDER;
}

/** Resolve a provider instance (selected one by default). */
export function getProvider(name: ProviderName = selectedProviderName()): EmailProvider {
  return PROVIDERS[name] ?? PROVIDERS[DEFAULT_PROVIDER];
}

/**
 * The single entry point a future send flow would call. Enforces the master
 * switch itself (defence in depth) so that — no matter which provider is
 * selected — nothing goes out while the layer is disarmed.
 */
export async function dispatch(email: OutboundEmail, provider: EmailProvider = getProvider()): Promise<SendResult> {
  if (provider.name !== "revenue-center" && !isSendArmed()) {
    return ok(provider.name, "skipped", { detail: "master switch off (REVENUE_SEND_ENABLED != 1) — dry-run" });
  }
  return provider.send(email);
}
