// Brand Guardian demo — runs sample drafts through QA before preview/approval.

import { checkContent, rotateCTA, withCalendar } from "./brand-guardian.js";

const DRAFTS = [
  "Scope 3 muss nicht kompliziert sein.\nLade deine Lieferantendaten hoch und sieh deine Hotspots.\nKostenlos testen",
  "Wir machen dich 100% klimaneutral  --  garantiert nachhaltig. Lassen Sie uns eintauchen.",
];

DRAFTS.forEach((draft, i) => {
  const r = checkContent(draft);
  console.log(`\n--- Draft ${i + 1} --- ok=${r.ok}`);
  for (const issue of r.issues) console.log(`  [${issue.severity}] ${issue.kind}: ${issue.detail}`);
  if (!r.ok) console.log("  → BLOCKED: human edit required before preview.");
  else console.log(`  → corrected & ready for preview. CTA: ${withCalendar(rotateCTA(i), "{{DEMO_CALENDAR_URL}}")}`);
});
