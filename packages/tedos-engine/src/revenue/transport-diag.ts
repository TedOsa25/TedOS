// Nodemailer transport-options diff: send:test vs batch:send.
//
// Reconstructs the EXACT createTransport() options each path builds from the
// current env (mirroring send-test.ts and sending.ts line-for-line), prints
// both with the password masked, and reports the first differing field.
//
//   REVENUE_EMAIL_PROVIDER=smtp SMTP_HOST=smtp.ionos.de SMTP_PORT=465 \
//     SMTP_SECURE=1 SMTP_USER='ted@heycarbo.com' SMTP_PASS='…' npm run transport:diag

const H = process.env.SMTP_HOST;
const U = process.env.SMTP_USER;
const P = process.env.SMTP_PASS;

// ── send:test (src/revenue/send-test.ts) ────────────────────────────────────
const st_secure = process.env.SMTP_SECURE === "1";
const st_port = Number(process.env.SMTP_PORT ?? (st_secure ? 465 : 587));
const sendTest = {
  host: H,
  port: st_port,
  secure: st_secure,
  requireTLS: !st_secure,
  auth: { user: U, pass: P },
  pool: false,
  maxConnections: 1,
  maxMessages: 1,
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
} as Record<string, unknown>;

// ── batch:send (src/revenue/sending.ts smtp provider + batch-send-run preflight)
// Now aligned to the send:test transport exactly.
const bs_secure = process.env.SMTP_SECURE === "1";
const batchSend = {
  host: H,
  port: Number(process.env.SMTP_PORT ?? (bs_secure ? 465 : 587)),
  secure: bs_secure,
  requireTLS: !bs_secure,
  auth: { user: U, pass: P },
  pool: false,
  maxConnections: 1,
  maxMessages: 1,
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
} as Record<string, unknown>;

/** Mask the password in a transport-options object for logging. */
function masked(o: Record<string, unknown>): Record<string, unknown> {
  const a = o.auth as { user?: string; pass?: string } | undefined;
  return { ...o, auth: a ? { user: a.user, pass: a.pass ? "***" : a.pass } : a };
}

function norm(v: unknown): string {
  if (v && typeof v === "object" && "user" in (v as any)) return `auth(user=${(v as any).user})`;
  return v === undefined ? "undefined" : JSON.stringify(v);
}

console.log("── send:test transport ──");
console.log(JSON.stringify(masked(sendTest), null, 2));
console.log("── batch:send transport ──");
console.log(JSON.stringify(masked(batchSend), null, 2));

const keys = ["host", "port", "secure", "requireTLS", "auth", "pool", "maxConnections", "maxMessages", "connectionTimeout", "greetingTimeout", "socketTimeout", "tls"];
console.log("── DIFF (send:test → batch:send) ──");
let first: string | null = null;
for (const k of keys) {
  const a = k === "auth" ? `auth(user=${U})` : norm(sendTest[k]);
  const b = k === "auth" ? `auth(user=${U})` : norm(batchSend[k]);
  if (a !== b) {
    console.log(`  ${k}: ${a}  →  ${b}`);
    if (!first) first = k;
  }
}
console.log(first ? `\n➡ Erste Abweichung: "${first}"` : "\nKeine Abweichung in den relevanten Feldern.");
console.log(`\nHinweis: 'secure', 'port', 'host', 'auth.user' sind auth-relevant. 'requireTLS'/'pool'/Timeouts sind es bei 465/secure=true NICHT.`);
