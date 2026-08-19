// Konzerne, für die im CRM keine Mitarbeiterzahl steht.
//
// WARUM ES DIESE LISTE GIBT
// Die Auswahlregeln schliessen Unternehmen über 10.000 Mitarbeitende aus: dort
// erreicht eine Kaltmail an info@ keinen Entscheider, und eine Lösung ist
// praktisch immer schon im Haus. Diese Regel kann nur greifen, wenn die Zahl
// bekannt ist — und bei 55 % der kontaktierten Leads (945 von 1.724) steht im
// CRM gar keine. Der Nachfass-Lauf schlug deshalb am 19.08. Schaeffler, MAHLE,
// Freudenberg, Knorr-Bremse, MANN+HUMMEL und Eberspächer in EINEM Batch vor.
//
// Das ist eine Datenlücke, keine Regellücke. Die dauerhafte Lösung ist, die
// Mitarbeiterzahlen nachzutragen. Bis dahin schliesst diese Liste die Fälle,
// die man ohne Recherche benennen kann: grosse, bekannte Industriekonzerne im
// deutschsprachigen Raum.
//
// BEWUSST NUR ZWEIFELSFREIE FÄLLE. Jeder Eintrag liegt deutlich über 10.000
// Mitarbeitenden — keine Grenzfälle, denn ein falscher Ausschluss ist teurer
// als eine überflüssige Mail: Bcomp hat 51 Mitarbeitende und ist unsere
// aussichtsreichste Anfrage.
//
// BEIM ERSTEN DURCHGANG SELBST FALSCH GEMACHT: die Liste enthielt Pilz (~2.500
// MA), WAGO (~9.000), Weidmüller (~5.600), ALTANA (~8.000), Aurubis (~7.000),
// ElringKlinger (~9.000) und Metsä (~9.300). Alle liegen UNTER der Grenze, Pilz
// sogar mitten im Zielprofil. Wer eine Ausschlussliste schreibt, muss jeden
// Eintrag einzeln rechtfertigen können — sonst wächst sie um Namen, die nur
// gross KLINGEN.
//
// Abgeglichen wird gegen die E-Mail-DOMAIN, nicht den Firmennamen. Namen
// variieren ("MAHLE GmbH", "MAHLE International"), Domains nicht — und ein
// Namensabgleich auf Teilzeichenketten trifft irgendwann eine kleine Firma,
// die zufällig so heisst.

/** Domains von Konzernen über ~10.000 Mitarbeitenden (Stand 08/2026). */
export const GROSSKONZERN_DOMAINS: ReadonlySet<string> = new Set([
  // Automotive-Zulieferer
  "schaeffler.com", "mahle.com", "freudenberg.com", "knorr-bremse.com",
  "mann-hummel.com", "eberspaecher.com", "continental.com", "conti.de",
  "zf.com", "bosch.com", "bosch.de", "hella.com", "brose.com", "webasto.com",
  "draexlmaier.com", "benteler.com", "vitesco-technologies.com",
  "leoni.com", "aptiv.com", "valeo.com", "magna.com",
  "kostal.com", "rehau.com", "mubea.com", "kirchhoff-automotive.com",
  // Chemie / Werkstoffe
  "basf.com", "evonik.com", "covestro.com", "lanxess.com", "wacker.com",
  "henkel.com", "arkema.com",
  "roechling.com",
  // Maschinen- und Anlagenbau, Elektro
  "siemens.com", "thyssenkrupp.com", "voith.com", "gea.com", "duerr.com", "durr.com",
  "kion-group.com", "liebherr.com", "sew-eurodrive.de", "phoenixcontact.com",
  // Metall / Stahl
  "salzgitter-ag.com", "arcelormittal.com", "hydro.com",
  // Verpackung / Papier
  "smurfitkappa.com", "mondigroup.com", "storaenso.com", "upm.com",
  "tetrapak.com",
]);

/** True, wenn die Adresse zu einem der gelisteten Konzerne gehört. */
export function istGrosskonzern(email: string | undefined): boolean {
  const domain = String(email ?? "").split("@")[1]?.toLowerCase().replace(/^www\./, "");
  if (!domain) return false;
  if (GROSSKONZERN_DOMAINS.has(domain)) return true;
  // Landesgesellschaften: mahle.de, siemens.at, basf.ch … gleicher Konzern.
  return [...GROSSKONZERN_DOMAINS].some((d) => {
    const stamm = d.replace(/\.[a-z.]+$/, "");
    return domain === `${stamm}.de` || domain === `${stamm}.at` || domain === `${stamm}.ch`
      || domain.endsWith(`.${d}`);
  });
}
