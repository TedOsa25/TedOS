# Release Checklist V1 — Revenue Outreach

Kontrollierter Rollout des E-Mail-/Revenue-Versands. Jede Stufe wird erst freigegeben, wenn
die vorherige nachweislich sauber lief. **Master-Switch (`REVENUE_SEND_ENABLED`) bleibt bis
zur SMTP-Test-Stufe auf `0`.**

Bezug: PR [#1](https://github.com/TedOsa25/TedOS/pull/1) · ADR [`0001`](adr/0001-greenfield-engine-pr.md) · Follow-up [Issue #2](https://github.com/TedOsa25/TedOS/issues/2)

## Vorbedingungen (Gate 0)
- [ ] Typecheck grün (`npm run typecheck`, exit 0)
- [ ] Tests grün (`npm test`, 0 fail)
- [ ] `tsconfig.json` eingecheckt
- [ ] SMTP-Hardening abgeschlossen (Issue #2: nodemailer-Types, `send-test.ts` finalisiert)

---

## 1. Merge
- [ ] Review von PR #1 abgeschlossen
- [ ] Merge nach `main` (kein Auto-Merge)
- [ ] `main` typecheckt & testet grün nach Merge
- ⬇

## 2. Deploy
- [ ] Engine auf Zielumgebung deployt
- [ ] Environment/Secrets gesetzt (`SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`)
- [ ] `REVENUE_SEND_ENABLED=0` verifiziert (Versand noch aus)
- [ ] Smoke-Test der Engine (Loop startet, keine Runtime-Fehler)
- ⬇

## 3. SMTP Test
- [ ] Einzelversand an **einen** verifizierten internen Empfänger (`REVENUE_SEND_ENABLED=1`)
- [ ] Zustellung bestätigt (kein Spam-Ordner)
- [ ] Rendering geprüft: Gmail **und** Outlook (Banner, Signatur, Bilder)
- [ ] Single-Send-Counter + Empfänger-Assertion greifen nachweislich
- [ ] Nach Test wieder disarmen (`REVENUE_SEND_ENABLED=0`)
- ⬇

## 4. 20 Leads
- [ ] Empfängerliste kuratiert & doppelt geprüft (Opt-in/Legitimität)
- [ ] Versand an 20 Leads
- [ ] Bounce-/Spam-Rate kontrolliert, Antworten beobachtet
- [ ] Keine Zustell-/Reputationsprobleme
- ⬇

## 5. 50 Leads
- [ ] Versand an 50 Leads
- [ ] Zustellrate & Antwortquote dokumentiert
- [ ] Domain-Reputation (SPF/DKIM/DMARC) stabil
- ⬇

## 6. 100 Leads
- [ ] Versand an 100 Leads
- [ ] Rate-Limits/Sending-Fenster eingehalten
- [ ] Metriken vs. vorherige Stufe verglichen
- ⬇

## 7. 250 Leads
- [ ] Versand an 250 Leads
- [ ] Zustell-/Bounce-/Reputationsmetriken im grünen Bereich
- [ ] Approval-/Brand-Gates bei Skalierung weiterhin wirksam
- ⬇

## 8. 1000+ Leads
- [ ] Skalierung >1000 freigegeben
- [ ] Monitoring & Alerting aktiv (Bounce-, Complaint-, Reputation-Schwellen)
- [ ] Rollback-/Pause-Prozedur dokumentiert und getestet
- [ ] Regulär: Versand nur nach Approval-Gate, disarmed-by-default zwischen Kampagnen

---

**Abbruchkriterien (jede Stufe):** Bounce-Rate zu hoch, Spam-Beschwerden, DMARC-Fehler oder
Reputationsabfall → sofort disarmen (`REVENUE_SEND_ENABLED=0`), Ursache klären, nicht eskalieren.
