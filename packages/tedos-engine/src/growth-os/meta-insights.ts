// Meta-Anschluss des Growth OS: NUR LESEN.
//
// Holt fuer das HeyAudit-Werbekonto die Kennzahlen der letzten Tage
// (Ausgaben, Impressionen, Klicks, Registrierungen ueber Anzeigen) und die
// Pixel-Ereignisse der Website (Registrierungsseite, begonnen, abgeschlossen)
// und formt daraus die Meta-Quelle des Briefings.
//
// Nutzt ausschliesslich GET-Aufrufe der Graph API. Keine Kampagne, kein
// Budget, keine Anzeige wird angelegt oder geaendert.
// Token: Keychain-Dienst "heyaudit-meta-ads-read" (Recht ads_read).

export const META_API_VERSION = "v21.0";
export const META_KONTO = "1081387852541408"; // HeyAudit, siehe Memory heyaudit-meta-ad-account
export const META_PIXEL = "1911866603090505";
export const META_KEYCHAIN_DIENST = "heyaudit-meta-ads-read";

/** Registrierung, wie Meta sie in `actions` einer Anzeige meldet. */
const REGISTRIERUNG_AKTIONEN = ["offsite_conversion.fb_pixel_complete_registration", "complete_registration"];

export interface MetaQuelle {
  stand: string;
  kontoId: string;
  zeitraum: string;
  ausgabenEur: number | null;
  impressionen: number | null;
  klicks: number | null;
  /** Registrierungen, die Meta einer Anzeige zuordnet. */
  leads: number | null;
  /** Alle Pixel-Ereignisse der Website (nur Besucher mit Marketing-Einwilligung). */
  pixel?: { signupAufrufe: number; registrierungBegonnen: number; registrierungen: number } | null;
}

interface InsightsZeile {
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
}

interface PixelStats {
  data?: { data?: { value: string; count: number }[] }[];
}

const num = (s: string | undefined): number | null => (s === undefined || s === "" ? null : Number(s));

/** Rein: Graph-Antworten -> Briefing-Quelle. */
export function metaQuelleAus(
  insights: { data?: InsightsZeile[] },
  pixel: PixelStats | null,
  tage: number,
  jetzt: Date,
): MetaQuelle {
  const z = insights.data?.[0];
  // Keine Zeile heisst: im Zeitraum nichts ausgeliefert. Das sind echte Nullen, keine Luecke.
  const leads = z
    ? (z.actions ?? [])
        .filter((a) => REGISTRIERUNG_AKTIONEN.includes(a.action_type))
        .reduce((m, a) => Math.max(m, Number(a.value)), 0)
    : 0;

  let px: MetaQuelle["pixel"] = null;
  if (pixel) {
    const summe = (name: string) =>
      (pixel.data ?? []).flatMap((b) => b.data ?? []).filter((e) => e.value === name).reduce((s, e) => s + e.count, 0);
    px = {
      signupAufrufe: summe("SignupAufgerufen"),
      registrierungBegonnen: summe("RegistrierungBegonnen"),
      registrierungen: summe("CompleteRegistration"),
    };
  }

  return {
    stand: jetzt.toISOString(),
    kontoId: META_KONTO,
    zeitraum: `${tage} Tage`,
    ausgabenEur: z ? num(z.spend) : 0,
    impressionen: z ? num(z.impressions) : 0,
    klicks: z ? num(z.clicks) : 0,
    leads,
    pixel: px,
  };
}

export type Abrufer = (url: string, init?: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Fehlertext ohne Token: Meta gibt in Fehlern nie das Token zurueck, die URL schon. */
function ohneToken(url: string): string {
  return url.replace(/access_token=[^&]+/, "access_token=***");
}

/** Holt beide Quellen. Wirft mit verstaendlicher Meldung, nie mit Token. */
export async function holeMetaQuelle(token: string, tage: number, jetzt: Date, abruf: Abrufer = fetch as unknown as Abrufer): Promise<MetaQuelle> {
  const basis = `https://graph.facebook.com/${META_API_VERSION}`;
  const bis = Math.floor(jetzt.getTime() / 1000);
  const von = bis - tage * 86_400;
  const tag = (d: Date) => d.toISOString().slice(0, 10);
  const zeitraum = encodeURIComponent(JSON.stringify({ since: tag(new Date(von * 1000)), until: tag(jetzt) }));
  const t = `access_token=${encodeURIComponent(token)}`;

  const urlInsights = `${basis}/act_${META_KONTO}/insights?fields=spend,impressions,clicks,actions&time_range=${zeitraum}&${t}`;
  const r1 = await abruf(urlInsights);
  if (!r1.ok) throw new Error(`Meta Insights HTTP ${r1.status} (${ohneToken(urlInsights).split("?")[0]})`);
  const insights = (await r1.json()) as { data?: InsightsZeile[] };

  // Pixel-Statistik ist eine Zugabe: fehlt das Recht, bleibt sie leer statt den Lauf zu kippen.
  const urlPixel = `${basis}/${META_PIXEL}/stats?aggregation=event&start_time=${von}&end_time=${bis}&${t}`;
  let pixel: PixelStats | null = null;
  try {
    const r2 = await abruf(urlPixel);
    if (r2.ok) pixel = (await r2.json()) as PixelStats;
  } catch {
    pixel = null;
  }
  return metaQuelleAus(insights, pixel, tage, jetzt);
}
