// SMTP env diagnostic — prints exactly what a send would receive, password masked.
// Run it prefixed with the SAME env block as send:test and as batch:send, then
// compare: if SMTP_PASS(fingerprint) differs, the shell mangled the password
// (the ! / $ / § characters) — quote it in single quotes.
//
//   REVENUE_EMAIL_PROVIDER=smtp SMTP_HOST=smtp.ionos.de SMTP_PORT=465 \
//     SMTP_SECURE=1 SMTP_USER='ted@heycarbo.com' SMTP_PASS='…' npm run smtp:diag

import { createHash } from "node:crypto";
import { selectedProviderName } from "./sending.js";

const fp = (v: string | undefined): string =>
  v ? `len=${v.length} sha256=${createHash("sha256").update(v).digest("hex").slice(0, 8)}` : "<leer/ungesetzt>";

console.log("── SMTP-Inputs (Passwort maskiert) ──");
console.log(`SMTP_HOST=${process.env.SMTP_HOST ?? "<ungesetzt>"}`);
console.log(`SMTP_PORT=${process.env.SMTP_PORT ?? "<ungesetzt>"}`);
console.log(`SMTP_SECURE=${process.env.SMTP_SECURE ?? "<ungesetzt>"}`);
console.log(`SMTP_USER=${process.env.SMTP_USER ?? "<ungesetzt>"}`);
console.log(`Provider=${selectedProviderName()}`);
console.log(`SMTP_PASS(fingerprint)=${fp(process.env.SMTP_PASS)}`);
console.log("─────────────────────────────────────");
