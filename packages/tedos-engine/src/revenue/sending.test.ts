// Sending-layer tests. The layer must be INERT by default: nothing sends unless
// the master switch is armed AND a provider is configured. These tests run with
// the switch OFF, so no network call is ever made.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROVIDER, dispatch, getProvider, isSendArmed, providerStatus,
  selectedProviderName, type OutboundEmail,
} from "./sending.js";

const mail: OutboundEmail = {
  to: "empfaenger@example.com", from: "ted@heycarbo.com", fromName: "Ted Osammor",
  subject: "Test", html: "<p>Test</p>",
};

describe("sending: inert by default (no send without arming)", () => {
  test("master switch is OFF by default", () => {
    assert.equal(process.env.REVENUE_SEND_ENABLED, undefined);
    assert.equal(isSendArmed(), false);
  });

  test("default provider is the manual Revenue Center", () => {
    assert.equal(DEFAULT_PROVIDER, "revenue-center");
    assert.equal(selectedProviderName(), "revenue-center");
    assert.equal(getProvider().name, "revenue-center");
  });

  test("Revenue Center provider QUEUES for approval — never sends", async () => {
    const r = await dispatch(mail);
    assert.equal(r.provider, "revenue-center");
    assert.equal(r.status, "queued");
    assert.equal(r.ok, true);
    assert.match(r.detail ?? "", /approval/i);
  });

  test("a real provider is SKIPPED (dry-run) while disarmed — no network", async () => {
    const r = await dispatch(mail, getProvider("brevo"));
    assert.equal(r.provider, "brevo");
    assert.equal(r.status, "skipped");
    assert.match(r.detail ?? "", /master switch off/i);
  });

  test("even a configured provider is skipped while disarmed", async () => {
    process.env.BREVO_API_KEY = "test-key"; // configured…
    try {
      const r = await dispatch(mail, getProvider("brevo"));
      assert.equal(r.status, "skipped", "still dry-run: master switch governs");
    } finally {
      delete process.env.BREVO_API_KEY;
    }
  });
});

describe("sending: provider selection + status", () => {
  test("selection is env-driven and falls back to the safe default", () => {
    process.env.REVENUE_EMAIL_PROVIDER = "mailjet";
    assert.equal(selectedProviderName(), "mailjet");
    process.env.REVENUE_EMAIL_PROVIDER = "not-a-provider";
    assert.equal(selectedProviderName(), "revenue-center", "unknown → safe default");
    delete process.env.REVENUE_EMAIL_PROVIDER;
  });

  test("providerStatus lists all five with live readiness", () => {
    const st = providerStatus();
    assert.deepEqual(st.map((p) => p.name).sort(), ["brevo", "mailjet", "revenue-center", "ses", "smtp"]);
    const rc = st.find((p) => p.name === "revenue-center");
    assert.equal(rc?.configured, true, "manual approval needs no credentials");
    assert.equal(st.find((p) => p.name === "brevo")?.configured, false, "no BREVO_API_KEY set");
    assert.equal(st.filter((p) => p.selected).length, 1);
  });
});
