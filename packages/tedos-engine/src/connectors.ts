// Connectors for the Intelligence Layer.
//
// Sprint 9 adds only the connectors currently required — GitHub, Supabase,
// Vercel — and wires them to the EXISTING ConnectorRouter (no routing
// redesign). Each connector is independent: it reads only its own environment
// variables, depends on no other connector, and shares only a tiny Connector
// interface. They are read-only and offline by default — status() makes no
// network call and never prints secrets — so the kernel and the Worker
// interface are untouched.

import type { Task } from "./types.js";
import { ConnectorRouter, type ConnectorType } from "./connector-router.js";

/** A connector's read-only, secret-free status. */
export interface ConnectorStatus {
  /** True when the connector's environment configuration is present. */
  configured: boolean;
  /** Human-readable summary — names only, never tokens or keys. */
  detail: string;
}

/**
 * Connector is an external system a task can be routed to.
 *
 * The contract is deliberately minimal: a stable `type` (matching the
 * ConnectorRouter's output) and a read-only `status()`. Connectors classify
 * and report; they do not execute work, so no kernel seam changes.
 */
export interface Connector {
  readonly type: ConnectorType;
  readonly name: string;
  /** Read-only, offline: is it configured, and a safe one-line summary. */
  status(): ConnectorStatus;
}

/** Safe host extraction for a URL; falls back to the raw value. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * GitHubConnector — issues, pull requests, releases.
 *
 * Configured by GITHUB_TOKEN + GITHUB_REPO (the same vars the read-only
 * GitHub goal provider already uses). Reports config only; it opens nothing.
 */
export class GitHubConnector implements Connector {
  readonly type = "GitHub" as const;
  readonly name = "github";

  status(): ConnectorStatus {
    const repo = process.env.GITHUB_REPO;
    const configured = Boolean(process.env.GITHUB_TOKEN && repo);
    return {
      configured,
      detail: configured
        ? `repo ${repo} (read-only)`
        : "set GITHUB_TOKEN and GITHUB_REPO",
    };
  }
}

/**
 * SupabaseConnector — database, migrations, schema.
 *
 * Configured by SUPABASE_URL + SUPABASE_KEY. Reports the project host only;
 * the key is never read into the summary.
 */
export class SupabaseConnector implements Connector {
  readonly type = "Supabase" as const;
  readonly name = "supabase";

  status(): ConnectorStatus {
    const url = process.env.SUPABASE_URL;
    const configured = Boolean(url && process.env.SUPABASE_KEY);
    return {
      configured,
      detail: configured ? `project ${hostOf(url as string)}` : "set SUPABASE_URL and SUPABASE_KEY",
    };
  }
}

/**
 * VercelConnector — deployments, hosting.
 *
 * Configured by VERCEL_TOKEN (+ optional VERCEL_PROJECT). Read-only: it
 * reports config; it never triggers a deploy or rollback.
 */
export class VercelConnector implements Connector {
  readonly type = "Vercel" as const;
  readonly name = "vercel";

  status(): ConnectorStatus {
    const configured = Boolean(process.env.VERCEL_TOKEN);
    const project = process.env.VERCEL_PROJECT ?? "(default project)";
    return {
      configured,
      detail: configured ? `project ${project} (read-only)` : "set VERCEL_TOKEN",
    };
  }
}

/**
 * SocialConnector — an organic social platform the Growth Engine can publish to
 * AFTER approval. It extends the read-only Connector with a publish-gate. It
 * never publishes on its own: canPublish() is true only when credentials exist,
 * and actual publishing requires (1) an approved draft and (2) a live platform
 * API/token. Without credentials it is inert — exactly like the other
 * connectors' status reporting. No fabricated publishing.
 */
export interface SocialConnector extends Connector {
  /** True only when credentials are configured (gates approval-time publishing). */
  canPublish(): boolean;
}

/**
 * LinkedInConnector — organic LinkedIn posts (approval-gated).
 *
 * Configured by LINKEDIN_TOKEN (+ optional LINKEDIN_ORG). No token → inert.
 * Publishing is performed only after approval by a live API integration; this
 * adapter reports readiness and never posts on its own.
 */
export class LinkedInConnector implements SocialConnector {
  readonly type = "LinkedIn" as const;
  readonly name = "linkedin";

  status(): ConnectorStatus {
    const configured = Boolean(process.env.LINKEDIN_TOKEN);
    const org = process.env.LINKEDIN_ORG ?? "(personal/default)";
    return {
      configured,
      detail: configured ? `org ${org} (approval-gated publish)` : "set LINKEDIN_TOKEN (no publish until then)",
    };
  }

  canPublish(): boolean {
    return Boolean(process.env.LINKEDIN_TOKEN);
  }
}

/**
 * InstagramConnector — organic Instagram posts (approval-gated).
 *
 * Configured by INSTAGRAM_TOKEN (+ optional INSTAGRAM_ACCOUNT). No token → inert.
 */
export class InstagramConnector implements SocialConnector {
  readonly type = "Instagram" as const;
  readonly name = "instagram";

  status(): ConnectorStatus {
    const configured = Boolean(process.env.INSTAGRAM_TOKEN);
    const account = process.env.INSTAGRAM_ACCOUNT ?? "(default)";
    return {
      configured,
      detail: configured ? `account ${account} (approval-gated publish)` : "set INSTAGRAM_TOKEN (no publish until then)",
    };
  }

  canPublish(): boolean {
    return Boolean(process.env.INSTAGRAM_TOKEN);
  }
}

/** The result of routing a task to a connector. */
export interface ConnectorMatch {
  /** The type the ConnectorRouter chose. */
  type: ConnectorType;
  /** The matching connector, or null when the route has no external connector. */
  connector: Connector | null;
}

/**
 * ConnectorRegistry maps router decisions to connector instances.
 *
 * It REUSES the existing ConnectorRouter to choose a type, then looks up the
 * connector registered for it. Types without an external connector
 * (Filesystem, Claude, None) resolve to null and execution continues
 * normally — exactly the router's existing contract.
 */
export class ConnectorRegistry {
  private readonly byType: Map<ConnectorType, Connector>;

  constructor(
    connectors: Connector[] = [
      new GitHubConnector(),
      new SupabaseConnector(),
      new VercelConnector(),
      new LinkedInConnector(),
      new InstagramConnector(),
    ],
    private readonly router: ConnectorRouter = new ConnectorRouter(),
  ) {
    this.byType = new Map(connectors.map((c) => [c.type, c]));
  }

  /** Every registered connector. */
  all(): Connector[] {
    return [...this.byType.values()];
  }

  /** The connector registered for a type, if any. */
  get(type: ConnectorType): Connector | undefined {
    return this.byType.get(type);
  }

  /** Route a task through the existing router and resolve its connector. */
  forTask(task: Task): ConnectorMatch {
    const type = this.router.route(task);
    return { type, connector: this.byType.get(type) ?? null };
  }
}
