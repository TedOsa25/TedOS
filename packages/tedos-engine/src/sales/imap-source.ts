// IMAP polling source for the inbound agent (read-only).
//
// The HeyAudit app has no outbound webhook for signups/demo requests and the
// Google appointment page has none for bookings, so the short polling loop is
// the event trigger: every 5 minutes the scheduler reads new mail in
// ted@heyaudit.de (Google Workspace) since the last seen UID. The mailbox is
// opened with readOnly:true — no flags, no moves, nothing marked as read.
// Credentials come from the environment (the shell wrapper reads the
// keychain); they are never logged or written to state.

import { ImapFlow } from "imapflow";
import type { RawMail } from "./inbound.js";

// ── tiny MIME reader (plain text + text/calendar parts) ──────────────────

function decodeQP(s: string): Buffer {
  const bytes: number[] = [];
  const t = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (c === "=" && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(c, "utf8"));
  }
  return Buffer.from(bytes);
}

function decodeBody(body: string, enc: string | undefined, charset: string | undefined): string {
  const e = (enc ?? "").toLowerCase();
  const buf = e === "base64" ? Buffer.from(body.replace(/\s+/g, ""), "base64") : e === "quoted-printable" ? decodeQP(body) : Buffer.from(body, "binary");
  const cs = (charset ?? "utf-8").toLowerCase();
  try { return new TextDecoder(cs === "us-ascii" ? "utf-8" : cs).decode(buf); } catch { return buf.toString("utf8"); }
}

function headerBlock(part: string): { headers: Record<string, string>; body: string } {
  const idx = part.search(/\r?\n\r?\n/);
  const head = idx === -1 ? part : part.slice(0, idx);
  const body = idx === -1 ? "" : part.slice(idx).replace(/^\r?\n\r?\n/, "");
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) headers[(m[1] as string).toLowerCase()] = m[2] as string;
  }
  return { headers, body };
}

export function extractParts(source: string): { text: string; calendar: string[] } {
  const texts: string[] = [];
  const htmls: string[] = [];
  const calendar: string[] = [];
  const walk = (part: string, depth: number) => {
    if (depth > 6) return;
    const { headers, body } = headerBlock(part);
    const ct = headers["content-type"] ?? "text/plain";
    const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
    if (/^multipart\//i.test(ct) && boundary) {
      for (const p of body.split(`--${boundary}`).slice(1)) if (!p.startsWith("--")) walk(p.replace(/^\r?\n/, ""), depth + 1);
      return;
    }
    const charset = ct.match(/charset="?([^";]+)"?/i)?.[1];
    const decoded = decodeBody(body, headers["content-transfer-encoding"], charset);
    if (/^text\/calendar/i.test(ct) || /\.ics/i.test(headers["content-disposition"] ?? "")) calendar.push(decoded);
    else if (/^text\/plain/i.test(ct)) texts.push(decoded);
    else if (/^text\/html/i.test(ct)) htmls.push(decoded.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"));
  };
  walk(source, 0);
  return { text: (texts.length ? texts : htmls).join("\n").trim(), calendar };
}

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  folders: string[];
}

export function imapConfigFromEnv(): ImapConfig | undefined {
  const user = process.env.SALES_IMAP_USER;
  const pass = process.env.SALES_IMAP_PASS;
  if (!user || !pass) return undefined;
  return {
    host: process.env.SALES_IMAP_HOST ?? "imap.gmail.com",
    port: Number(process.env.SALES_IMAP_PORT ?? 993),
    user,
    pass,
    folders: (process.env.SALES_IMAP_FOLDERS ?? "INBOX").split(",").map((f) => f.trim()).filter(Boolean),
  };
}

export interface Cursor { [folder: string]: { uidValidity: string; lastUid: number } }

/**
 * Fetch mails newer than the cursor. First run (no cursor) reads the last
 * `backfillDays` days so existing leads are reconciled once.
 */
export async function fetchNewMail(cfg: ImapConfig, cursor: Cursor, backfillDays = 45): Promise<{ mails: RawMail[]; cursor: Cursor }> {
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false, socketTimeout: 120_000, greetingTimeout: 30_000 });
  let socketError: string | undefined;
  client.on("error", (e: Error) => { socketError = e.message; });
  const next: Cursor = { ...cursor };
  const mails: RawMail[] = [];
  await client.connect();
  try {
    for (const folder of cfg.folders) {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const mb = client.mailbox;
        const uidValidity = mb && typeof mb === "object" ? String(mb.uidValidity) : "0";
        const prev = cursor[folder];
        const fresh = !prev || prev.uidValidity !== uidValidity;
        const query = fresh ? { since: new Date(Date.now() - backfillDays * 86400000) } : { uid: `${prev.lastUid + 1}:*` };
        const uids = ((await client.search(query, { uid: true })) || []) as number[];
        const todo = uids.filter((u) => fresh || u > (prev?.lastUid ?? 0));
        let maxUid = fresh ? 0 : prev.lastUid;
        for (let i = 0; i < todo.length; i += 50) {
          const block = todo.slice(i, i + 50);
          for await (const msg of client.fetch({ uid: block.join(",") }, { uid: true, envelope: true, source: true }, { uid: true })) {
            maxUid = Math.max(maxUid, msg.uid);
            const source = msg.source?.toString("binary") ?? "";
            const { text, calendar } = extractParts(source);
            const env = msg.envelope;
            mails.push({
              messageId: (env?.messageId ?? `uid-${uidValidity}-${msg.uid}`).replace(/[<>]/g, ""),
              from: env?.from?.[0]?.address?.toLowerCase() ?? "",
              subject: env?.subject ?? "",
              date: (env?.date instanceof Date ? env.date : new Date()).toISOString(),
              text: text.slice(0, 20000),
              ...(calendar.length ? { calendar } : {}),
              ...(env?.inReplyTo ? { inReplyTo: env.inReplyTo } : {}),
              raw: Buffer.from(source, "binary").toString("utf8").slice(0, 40000),
            });
          }
        }
        next[folder] = { uidValidity, lastUid: maxUid };
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  if (socketError) throw new Error(`IMAP-Socketfehler: ${socketError}`);
  return { mails, cursor: next };
}
