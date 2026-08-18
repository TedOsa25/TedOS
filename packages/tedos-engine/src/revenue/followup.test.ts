// Tests für die Nachfass-Sequenz. Der Kern ist nicht "wer bekommt eine Mail",
// sondern "wer bekommt garantiert KEINE": wer geantwortet hat, wer sich
// abgemeldet hat, und alle, solange der Posteingang nicht ausgewertet wurde.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "./../storage.js";
import { normalize, type Account } from "./accounts.js";
import {
  selectFollowUps, followUpGate, recordInboxScan, workdaysBetween,
  type LeadRecord,
} from "./batch-send.js";

const acct = (id: string, i: number): Account =>
  normalize({ id, name: `Co ${id}`, industry: "Metall", email: `info@${id}.de`, prio: "A", score: 80 } as never, i);

const NOW = "2026-08-11T09:00:00.000Z";           // Dienstag
const VOR_6_WT = "2026-08-03T09:00:00.000Z";      // Montag → 6 Werktage
const VOR_2_WT = "2026-08-07T09:00:00.000Z";      // Freitag → 2 Werktage

function store(records: Record<string, LeadRecord>): InMemoryStorage {
  const s = new InMemoryStorage();
  s.save("revenue-lead-status", records);
  return s;
}

describe("workdaysBetween", () => {
  test("zählt nur Werktage", () => {
    assert.equal(workdaysBetween("2026-08-07T09:00:00Z", "2026-08-11T09:00:00Z"), 2); // Fr→Di
    assert.equal(workdaysBetween("2026-08-03T09:00:00Z", "2026-08-11T09:00:00Z"), 6);
  });
  test("negative oder gleiche Zeitpunkte ergeben 0", () => {
    assert.equal(workdaysBetween(NOW, NOW), 0);
    assert.equal(workdaysBetween(NOW, VOR_6_WT), 0);
  });
});

describe("selectFollowUps: wer KEINE Nachfassmail bekommt", () => {
  const accounts = ["a", "b", "c", "d", "e", "f"].map(acct);

  test("wer geantwortet hat, ist raus — sonst verbrennt man den warmen Kontakt", () => {
    const s = store({
      a: { status: "sent", sent_at: VOR_6_WT },
      b: { status: "replied", sent_at: VOR_6_WT },
      c: { status: "demo-booked", sent_at: VOR_6_WT },
    });
    const sel = selectFollowUps(accounts, s.load("revenue-lead-status")!, { limit: 20, now: NOW });
    assert.deepEqual(sel.batch.map((x) => x.account.id), ["a"]);
    assert.equal(sel.excluded.replied, 1);
    assert.equal(sel.excluded["demo-booked"], 1);
  });

  test("Abgemeldete und Bounces sind dauerhaft gesperrt", () => {
    const s = store({
      a: { status: "unsubscribed", sent_at: VOR_6_WT },
      b: { status: "bounced", sent_at: VOR_6_WT },
    });
    const sel = selectFollowUps(accounts, s.load("revenue-lead-status")!, { limit: 20, now: NOW });
    assert.equal(sel.batch.length, 0);
  });

  test("vor Ablauf der Wartezeit passiert nichts", () => {
    const s = store({ a: { status: "sent", sent_at: VOR_2_WT } });
    const sel = selectFollowUps(accounts, s.load("revenue-lead-status")!, { limit: 20, now: NOW, minWorkdays1: 4 });
    assert.equal(sel.batch.length, 0);
    assert.equal(sel.tooEarly, 1);
  });

  test("nach zwei Nachfassmails endet die Sequenz", () => {
    const s = store({
      a: { status: "sent", sent_at: VOR_6_WT, followup1_at: VOR_6_WT, followup2_at: VOR_6_WT },
    });
    const sel = selectFollowUps(accounts, s.load("revenue-lead-status")!, { limit: 20, now: NOW });
    assert.equal(sel.batch.length, 0);
    assert.equal(sel.exhausted, 1);
  });

  test("nach FU1 folgt FU2 — gemessen ab der Nachfassmail, nicht ab dem Erstkontakt", () => {
    const s = store({ a: { status: "sent", sent_at: "2026-06-01T09:00:00Z", followup1_at: VOR_6_WT } });
    const sel = selectFollowUps(accounts, s.load("revenue-lead-status")!, { limit: 20, now: NOW, minWorkdays2: 5 });
    assert.equal(sel.batch[0]?.stage, 2);
  });

  test("wer am längsten wartet, kommt zuerst — innerhalb des Fensters", () => {
    const s = store({
      a: { status: "sent", sent_at: "2026-08-05T09:00:00Z" },   // 4 WT
      b: { status: "sent", sent_at: "2026-08-03T09:00:00Z" },   // 6 WT
    });
    const sel = selectFollowUps(accounts, s.load("revenue-lead-status")!, { limit: 20, now: NOW });
    assert.equal(sel.batch[0]?.account.id, "b");
  });

  // Die Nachfassmail geht als "Re: <Originalbetreff>" raus. Ohne Obergrenze
  // zog die Sortierung "älteste zuerst" genau die Kontakte nach vorn, bei denen
  // dieser Betreff eine Vorkorrespondenz behauptet, an die sich niemand mehr
  // erinnert: am 18.08. standen 20 Kandidaten mit 31 Werktagen in der Auswahl.
  test("nach dem Fenster wird nicht mehr nachgefasst — ein 'Re:' wäre dort gelogen", () => {
    const s = store({
      alt: { status: "sent", sent_at: "2026-06-01T09:00:00Z" },  // ~50 WT
      neu: { status: "sent", sent_at: "2026-08-03T09:00:00Z" },  // 6 WT
    });
    const sel = selectFollowUps([acct("alt", 0), acct("neu", 1)], s.load("revenue-lead-status")!, { limit: 20, now: NOW });
    assert.deepEqual(sel.batch.map((x) => x.account.id), ["neu"]);
    assert.equal(sel.tooLate, 1);
  });

  test("die Obergrenze ist einstellbar", () => {
    const s = store({ a: { status: "sent", sent_at: "2026-07-20T09:00:00Z" } }); // 16 WT
    const eng = selectFollowUps(accounts, s.load("revenue-lead-status")!, { limit: 20, now: NOW });
    const weit = selectFollowUps(accounts, s.load("revenue-lead-status")!, { limit: 20, now: NOW, maxWorkdays: 40 });
    assert.equal(eng.batch.length, 0);
    assert.equal(weit.batch.length, 1);
  });
});

describe("followUpGate: ohne ausgewerteten Posteingang wird nicht nachgefasst", () => {
  test("nie gescannt → gesperrt", () => {
    const g = followUpGate(new InMemoryStorage(), NOW);
    assert.equal(g.ok, false);
    assert.match(g.detail, /nie ausgewertet/);
  });

  test("veralteter Scan → gesperrt", () => {
    // Zwischenzeitliche Antworten und Abmeldungen wären unsichtbar.
    const s = new InMemoryStorage();
    recordInboxScan(s, { at: "2026-08-01T09:00:00.000Z", bounces: 0, optOuts: 0, replies: 0 });
    const g = followUpGate(s, NOW, 72);
    assert.equal(g.ok, false);
    assert.match(g.detail, /alt/);
  });

  test("frischer Scan gibt frei", () => {
    const s = new InMemoryStorage();
    recordInboxScan(s, { at: "2026-08-10T09:00:00.000Z", bounces: 2, optOuts: 1, replies: 3 });
    const g = followUpGate(s, NOW, 72);
    assert.equal(g.ok, true);
    assert.match(g.detail, /1 Abmeldungen/);
  });
});
