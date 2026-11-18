// Connectors demo.
//
// Shows the three required connectors (GitHub, Supabase, Vercel): their
// read-only config status, then routing example tasks through the EXISTING
// ConnectorRouter to the connector that should handle each. Offline, no
// network, no kernel changes.

import type { Task } from "./types.js";
import { ConnectorRegistry } from "./connectors.js";

const registry = new ConnectorRegistry();

console.log("Connector status (read-only, offline):\n");
for (const c of registry.all()) {
  const s = c.status();
  console.log(`  ${c.name.padEnd(9)} ${s.configured ? "configured" : "not configured"} — ${s.detail}`);
}

const EXAMPLES: string[] = [
  "Open a pull request to fix the bug",
  "Run a database migration for the new schema",
  "Deploy the latest build to production",
  "Roll back the broken deployment",
  "Update the README documentation", // routes to Filesystem -> no external connector
  "Reticulate the splines", // routes to None
];

console.log("\nRouting tasks to connectors:\n");
for (const description of EXAMPLES) {
  const task: Task = { id: "demo", description, kind: "general" };
  const { type, connector } = registry.forTask(task);
  const target = connector ? `${connector.name} connector` : `${type} (no external connector)`;
  console.log(`  "${description}"\n      -> ${target}\n`);
}
