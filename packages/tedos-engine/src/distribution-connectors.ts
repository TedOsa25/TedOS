// Distribution connectors — credential-gated publishers/senders.
//
// Each channel wraps the EXISTING connector convention (env-var detection, like
// connectors.ts / evidence.ts) and adds the action half: publish()/send(),
// healthCheck(), testCall(). It is gated twice so nothing ever leaks:
//   1) credentials — without the required env vars the publisher is INERT and
//      returns `skipped` + a concrete setup hint (never a fabricated success);
//   2) transport  — even WITH credentials, an actual network call only happens
//      when a live `Transport` is injected. Offline/by default no transport is
//      wired (no-deploy), so jobs come back `skipped` with setup instructions.
// This mirrors the existing SocialConnector.canPublish() gate — extended, not
// duplicated. Deterministic.

import type { DistributionChannel, DistributionJob } from "./distribution-queue.js";

export type PublishStatus = "published" | "sent" | "skipped" | "failed";

/** The result of attempting to distribute one job (secret-free). */
export interface PublishResult {
  ok: boolean;
  status: PublishStatus;
  detail: string;
  /** Concrete setup instructions when skipped for missing credentials. */
  setupHint?: string;
  /** External id from a real publish (only when a live transport ran). */
  externalId?: string;
}

/** A real network sender. Absent by default (offline/no-deploy); injected to go live. */
export type Transport = (job: DistributionJob, env: NodeJS.ProcessEnv) => {
  ok: boolean;
  externalId?: string;
  detail: string;
};

/** Health/probe result (no posting). */
export interface HealthResult {
  ok: boolean;
  detail: string;
}

/** Static config per channel — required env, terminal success status, setup pointer. */
interface ChannelConfig {
  channel: DistributionChannel;
  connector: string;
  envVars: string[];
  successStatus: Extract<PublishStatus, "published" | "sent">;
  setupHint: string;
}

const CONFIGS: Record<DistributionChannel, ChannelConfig> = {
  linkedin: {
    channel: "linkedin", connector: "linkedin", envVars: ["LINKEDIN_TOKEN"], successStatus: "published",
    setupHint: "Set LINKEDIN_TOKEN (+ LINKEDIN_ORG). See docs/connectors-setup.md §3 (Share on LinkedIn + Community Management API).",
  },
  instagram: {
    channel: "instagram", connector: "instagram", envVars: ["INSTAGRAM_TOKEN"], successStatus: "published",
    setupHint: "Set INSTAGRAM_TOKEN (+ INSTAGRAM_ACCOUNT). See docs/connectors-setup.md §4 (Instagram Graph Content Publishing).",
  },
  email: {
    channel: "email", connector: "gmail", envVars: ["GMAIL_TOKEN"], successStatus: "sent",
    setupHint: "Set GMAIL_TOKEN. See docs/connectors-setup.md §6 (Gmail API send scope).",
  },
  web: {
    channel: "web", connector: "web", envVars: ["VERCEL_TOKEN"], successStatus: "published",
    setupHint: "Set VERCEL_TOKEN (+ VERCEL_PROJECT) to publish web/landing/SEO pages. See docs/connectors-setup.md §7.",
  },
};

/**
 * True when every required env var for the channel is present. This is the same
 * env-token gate the existing SocialConnector.canPublish() uses (LINKEDIN_TOKEN
 * / INSTAGRAM_TOKEN), evaluated against the injected env so it stays testable.
 */
function credsPresent(cfg: ChannelConfig, env: NodeJS.ProcessEnv): boolean {
  return cfg.envVars.every((v) => Boolean(env[v]));
}

/** A credential- and transport-gated publisher for one channel. */
export interface Publisher {
  readonly channel: DistributionChannel;
  readonly connector: string;
  ready(env: NodeJS.ProcessEnv): boolean;
  healthCheck(env: NodeJS.ProcessEnv): HealthResult;
  /** No-op connectivity probe — reports readiness; NEVER posts. */
  testCall(env: NodeJS.ProcessEnv): HealthResult;
  /** Distribute a job, gated. Without creds/transport → skipped + setup hint. */
  publish(job: DistributionJob, env: NodeJS.ProcessEnv): PublishResult;
}

class CredentialGatedPublisher implements Publisher {
  readonly channel: DistributionChannel;
  readonly connector: string;

  constructor(private readonly cfg: ChannelConfig, private readonly transport?: Transport) {
    this.channel = cfg.channel;
    this.connector = cfg.connector;
  }

  ready(env: NodeJS.ProcessEnv): boolean {
    return credsPresent(this.cfg, env);
  }

  healthCheck(env: NodeJS.ProcessEnv): HealthResult {
    if (!this.ready(env)) {
      const missing = this.cfg.envVars.filter((v) => !env[v]);
      return { ok: false, detail: `${this.connector}: missing ${missing.join(", ")} — ${this.cfg.setupHint}` };
    }
    const transport = this.transport ? "live transport wired" : "no live transport (no-deploy)";
    return { ok: true, detail: `${this.connector}: credentials present; ${transport}` };
  }

  testCall(env: NodeJS.ProcessEnv): HealthResult {
    // Deterministic, offline: confirms config without making a posting call.
    return this.healthCheck(env);
  }

  publish(job: DistributionJob, env: NodeJS.ProcessEnv): PublishResult {
    if (!this.ready(env)) {
      return { ok: false, status: "skipped", detail: `${this.connector}: credentials missing`, setupHint: this.cfg.setupHint };
    }
    if (!this.transport) {
      return {
        ok: false,
        status: "skipped",
        detail: `${this.connector}: credentials present but no live transport configured (no-deploy)`,
        setupHint: this.cfg.setupHint,
      };
    }
    const r = this.transport(job, env);
    if (!r.ok) return { ok: false, status: "failed", detail: `${this.connector}: ${r.detail}` };
    const result: PublishResult = { ok: true, status: this.cfg.successStatus, detail: `${this.connector}: ${r.detail}` };
    if (r.externalId !== undefined) result.externalId = r.externalId;
    return result;
  }
}

/** Resolves the publisher for a job's channel. One per channel; no duplicates. */
export class PublisherRegistry {
  private readonly byChannel: Map<DistributionChannel, Publisher>;

  constructor(transports: Partial<Record<DistributionChannel, Transport>> = {}) {
    this.byChannel = new Map(
      (Object.keys(CONFIGS) as DistributionChannel[]).map((ch) => [
        ch,
        new CredentialGatedPublisher(CONFIGS[ch], transports[ch]),
      ]),
    );
  }

  get(channel: DistributionChannel): Publisher | undefined {
    return this.byChannel.get(channel);
  }

  all(): Publisher[] {
    return [...this.byChannel.values()];
  }

  /** Health of every channel — for the Connector Health Check. */
  healthReport(env: NodeJS.ProcessEnv = process.env): { channel: DistributionChannel; health: HealthResult }[] {
    return this.all().map((p) => ({ channel: p.channel, health: p.healthCheck(env) }));
  }
}
