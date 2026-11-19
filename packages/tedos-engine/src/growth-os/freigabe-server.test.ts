// Freigabe-Seite: zeigt offene Vorschlaege samt Wochenplan, setzt nur den Status.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApprovalQueue } from "../approval-queue.js";
import { InMemoryStorage } from "../storage.js";
import { KATALOG } from "./content-katalog.js";
import { baueWochenplan, wochenplanFreigabe } from "./content-plan.js";
import { createFreigabeServer, renderSeite } from "./freigabe-server.js";
import { SignalLog } from "./signal.js";

const JETZT = new Date("2026-11-11T08:00:00Z");

describe("Freigabe-Seite", () => {
  test("Leere Warteschlange", () => {
    assert.match(renderSeite([], []), /Keine offenen Vorschläge/);
  });

  test("Titel und Texte werden escaped", () => {
    const plan = baueWochenplan(KATALOG, { jetzt: JETZT });
    const e = { ...wochenplanFreigabe(plan), title: "<b>x</b>", status: "pending" as const, createdAt: JETZT.toISOString() };
    const html = renderSeite([{ e, plan }], []);
    assert.ok(!html.includes("<b>x</b>"));
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(html, /Krankmeldung kurz vor der Schicht\?/);
  });

  test("Freigeben über die Seite setzt Status und protokolliert, zweites Mal 400", async () => {
    const dir = mkdtempSync(join(tmpdir(), "growth-freigabe-"));
    try {
      const plan = baueWochenplan(KATALOG, { jetzt: JETZT });
      mkdirSync(join(dir, "content"));
      writeFileSync(join(dir, "content", "plan-2026-kw47.json"), JSON.stringify(plan));
      const storage = new InMemoryStorage();
      new ApprovalQueue(storage).enqueue(wochenplanFreigabe(plan));

      const server = createFreigabeServer({ growthDir: dir, storage, jetzt: () => JETZT });
      await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
      const basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        const seite = await (await fetch(basis + "/")).text();
        assert.match(seite, /Instagram-Wochenplan KW 47/);
        assert.match(seite, /utm_campaign=ig-2026-kw47/);

        const post = (aktion: string) =>
          fetch(basis + "/entscheiden", {
            method: "POST",
            redirect: "manual",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ goalId: "growth:content:ig-2026-kw47", aktion }).toString(),
          });
        assert.equal((await post("freigeben")).status, 303);
        assert.equal(new ApprovalQueue(storage).byStatus("approved")[0]!.goalId, "growth:content:ig-2026-kw47");
        assert.equal((await post("ablehnen")).status, 400);
        assert.deepEqual(new SignalLog(join(dir, "signale.jsonl")).lesen({ art: "freigabe.erteilt" }).length, 1);
      } finally {
        server.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
