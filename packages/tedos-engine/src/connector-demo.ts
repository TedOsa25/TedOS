// Connector Router demo.
//
// Shows the deterministic routing: Task -> ConnectorRouter -> ConnectorType.
// No connectors are invoked; this only classifies.

import type { Task } from "./types.js";
import { ConnectorRouter } from "./connector-router.js";

const router = new ConnectorRouter();

const EXAMPLES: string[] = [
  "Upgrade React",
  "Run a database migration",
  "Update the project documentation",
  "Implement a new coding feature",
  "Reticulate the splines",
];

for (const description of EXAMPLES) {
  const task: Task = { id: "demo", description, kind: "general" };
  console.log(`Task:\n${description}\n\nSelected connector:\n${router.route(task)}\n`);
}
