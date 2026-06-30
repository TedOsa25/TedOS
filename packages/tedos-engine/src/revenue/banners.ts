// Revenue Engine — banner/asset references.
//
// Banners are NOT generated. We only REFERENCE the real central assets that
// exist in Sales/. Reality (per audit): one signature banner + a set of themed
// hero photos — there are NO true per-industry banners. So we map an industry to
// the closest existing themed asset and flag every industry that has no
// industry-specific banner as an asset gap (surfaced in the Revenue Center).

/** A referenced banner asset (never generated). */
export interface BannerRef {
  industry: string;
  asset: string;
  url: string;
  /** True only for a real industry-specific banner. Today: always false. */
  industrySpecific: boolean;
}

/** The one real signature banner — the default for every email. */
const DEFAULT_BANNER = {
  asset: "Sales/assets/heycarbo_signature_banner.png",
  url: "https://heycarbo.com/assets/signature/banner.png",
};

/** Themed hero photos that exist under Sales/social/visuals/png-photo/. */
const HERO = (name: string): string => `Sales/social/visuals/png-photo/${name}.png`;

/** Industry → closest existing themed hero (NOT industry-specific banners). */
const INDUSTRY_THEME: { re: RegExp; asset: string }[] = [
  { re: /automotive|mobility|fahrzeug|auto/i, asset: HERO("truckHighway") },
  { re: /logist|transport|spedition/i, asset: HERO("truckSunset2") },
  { re: /energie|energy|stahl|aluminium|steel/i, asset: HERO("truckTurbines") },
  { re: /maschinen|machinery|anlagen|elektronik|werkzeug/i, asset: HERO("building") },
  { re: /chemie|chemical|kunststoff|plastic|masterbatch|verpackung|packaging/i, asset: HERO("worker") },
  { re: /food|lebensmittel|getränk/i, asset: HERO("teamOverlook") },
];

/**
 * Resolve a banner for an industry. Always returns an EXISTING asset; falls back
 * to the default signature banner. `industrySpecific` is false because no true
 * per-industry banner exists yet — the gap is reported separately.
 */
export function bannerFor(industry: string): BannerRef {
  const theme = INDUSTRY_THEME.find((t) => t.re.test(industry));
  return {
    industry,
    asset: theme?.asset ?? DEFAULT_BANNER.asset,
    url: DEFAULT_BANNER.url,
    industrySpecific: false,
  };
}

/**
 * The distinct industries that lack a true industry-specific banner (i.e. all of
 * them today). Surfaced so an operator can commission the missing hero assets.
 */
export function bannerGaps(industries: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const i of industries) {
    const ref = bannerFor(i);
    if (!ref.industrySpecific) seen.add(i);
  }
  return [...seen].sort();
}
