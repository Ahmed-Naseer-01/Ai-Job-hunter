/** Small geography lexicon used for eligibility checks. Not exhaustive; unknown places never count as evidence. */

interface Place {
  name: string;
  /** Country this entry resolves to (for cities); undefined for regions. */
  country?: string;
  region?: boolean;
  re: RegExp;
}

const c = (name: string, re: RegExp): Place => ({ name, country: name, re });
const city = (name: string, country: string, re?: RegExp): Place => ({ name, country, re: re ?? new RegExp(`\\b${name}\\b`, "i") });
const region = (name: string, re: RegExp): Place => ({ name, region: true, re });

/** Places that do NOT include Pakistan. Abbreviations (US, UK, EU) are case-sensitive on purpose. */
export const EXCLUDING_PLACES: Place[] = [
  region("United States", /\b(?:US|U\.S\.|USA|U\.S\.A\.)(?![a-z])/),
  c("United States", /united states(?: of america)?/i),
  region("North America", /north america|\bamericas\b/i),
  c("Canada", /\bcanad(?:a|ian)\b/i),
  c("United Kingdom", /\bUK\b|united kingdom|\bbritain\b|\bengland\b|\bscotland\b|\bwales\b/),
  region("Europe", /\beurope(?:an)?\b|\bnordics?\b/i),
  region("Europe", /\bEU\b|\bEEA\b|\bDACH\b/),
  region("EMEA", /\bEMEA\b/),
  region("LATAM", /\blatam\b|latin america/i),
  region("MENA / Middle East", /\bMENA\b|middle east/i),
  region("Africa", /\bafrica\b/i),
  region("Oceania / ANZ", /\bANZ\b|\boceania\b/),
  ...[
    "Ireland", "Germany", "France", "Spain", "Portugal", "Italy", "Netherlands", "Belgium", "Poland", "Romania", "Sweden", "Norway", "Denmark",
    "Finland", "Switzerland", "Austria", "Czechia", "Hungary", "Greece", "Turkey", "Ukraine", "Israel", "Egypt", "Nigeria", "Kenya", "South Africa",
    "India", "Bangladesh", "Sri Lanka", "Singapore", "Malaysia", "Indonesia", "Philippines", "Vietnam", "Thailand", "Japan", "South Korea", "China",
    "Hong Kong", "Taiwan", "Australia", "New Zealand", "Brazil", "Argentina", "Mexico", "Colombia", "Chile", "Saudi Arabia", "Qatar", "Estonia",
    "Lithuania", "Latvia", "Bulgaria", "Serbia", "Croatia", "Slovakia", "Slovenia", "Morocco", "Ghana", "Peru", "Uruguay", "Costa Rica",
  ].map((n) => c(n, new RegExp(`\\b${n}\\b`, "i"))),
  c("United Arab Emirates", /\bUAE\b|united arab emirates|\bdubai\b|abu dhabi/i),
  c("Czechia", /czech/i),
  city("London", "United Kingdom"), city("Berlin", "Germany"), city("Munich", "Germany"), city("Paris", "France"), city("Amsterdam", "Netherlands"),
  city("Dublin", "Ireland"), city("Toronto", "Canada"), city("Vancouver", "Canada"), city("New York", "United States"), city("San Francisco", "United States"),
  city("Seattle", "United States"), city("Austin", "United States"), city("Boston", "United States"), city("Chicago", "United States"),
  city("Los Angeles", "United States"), city("Denver", "United States"), city("Atlanta", "United States"), city("Bangalore", "India", /bangalore|bengaluru/i),
  city("Mumbai", "India"), city("Pune", "India"), city("Delhi", "India"), city("Sydney", "Australia"), city("Melbourne", "Australia"),
  city("Tel Aviv", "Israel"), city("Madrid", "Spain"), city("Barcelona", "Spain"), city("Lisbon", "Portugal"), city("Warsaw", "Poland"),
  city("Krakow", "Poland", /krak[oó]w/i), city("Stockholm", "Sweden"), city("Copenhagen", "Denmark"), city("Zurich", "Switzerland", /z(?:u|ü)rich/i),
  city("Tokyo", "Japan"), city("Riyadh", "Saudi Arabia"), city("Cairo", "Egypt"), city("Lagos", "Nigeria"), city("Nairobi", "Kenya"), city("Cape Town", "South Africa"),
];

/** Regions that contain Pakistan or could (need confirmation). */
export const ASIA_RE = /\bapac\b|asia[- ]pacific|\bsouth asia\b|\basia\b/i;

export const GLOBAL_RE = /\bworldwide\b|\banywhere\b|\bglobal(?:ly)?\b|\bany (?:country|countries|location)\b|\ball countries\b|\bwork from anywhere\b/i;

export function homeRegex(country: string): RegExp {
  if (/^pakistan$/i.test(country.trim())) return /\bpakistan\b|\blahore\b|\bkarachi\b|\bislamabad\b|\brawalpindi\b|\bfaisalabad\b|\bpeshawar\b|\bmultan\b/i;
  return new RegExp(`\\b${country.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

export interface PlaceScan {
  /** Names of non-home places/regions found (deduped). */
  places: string[];
  /** Countries resolved from places (deduped). */
  countries: string[];
  home: boolean;
  global: boolean;
  asia: boolean;
}

export function scanPlaces(text: string, home: RegExp, homeCountry?: string): PlaceScan {
  const places = new Set<string>();
  const countries = new Set<string>();
  for (const p of EXCLUDING_PLACES) {
    if (homeCountry && p.country && p.country.toLowerCase() === homeCountry.toLowerCase()) continue;
    if (p.re.test(text)) {
      places.add(p.name);
      if (p.country) countries.add(p.country);
    }
  }
  return { places: [...places], countries: [...countries], home: home.test(text), global: GLOBAL_RE.test(text), asia: ASIA_RE.test(text) };
}
