import type { Db } from "./types";
import { getSetting, setSetting } from "./settings";
import { AppSettingsSchema, DEFAULT_SETTINGS, ProfileSchema, type AppSettings, type Profile } from "../config/schema";
import { DEFAULT_PROFILE } from "../config/defaultProfile";
import { sha256 } from "../util";

function deepMerge<T>(base: T, over: any): T {
  if (over === null || over === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object" || base === null) return over as T;
  const out: any = { ...(base as any) };
  for (const k of Object.keys(over)) out[k] = k in (base as any) ? deepMerge((base as any)[k], over[k]) : over[k];
  return out;
}

export async function loadProfile(db: Db): Promise<Profile> {
  const stored = await getSetting<unknown>(db, "profile");
  if (!stored) return DEFAULT_PROFILE;
  const parsed = ProfileSchema.safeParse(deepMerge(DEFAULT_PROFILE, stored));
  return parsed.success ? parsed.data : DEFAULT_PROFILE;
}

export async function saveProfile(db: Db, input: unknown): Promise<Profile> {
  const p = ProfileSchema.parse(input);
  const total = Object.values(p.weights).reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("At least one match weight must be greater than zero");
  await setSetting(db, "profile", p);
  return p;
}

export async function loadSettings(db: Db): Promise<AppSettings> {
  const stored = await getSetting<unknown>(db, "app");
  if (!stored) return DEFAULT_SETTINGS;
  const parsed = AppSettingsSchema.safeParse(deepMerge(DEFAULT_SETTINGS, stored));
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(db: Db, input: unknown): Promise<AppSettings> {
  const s = AppSettingsSchema.parse(deepMerge(DEFAULT_SETTINGS, input));
  if (!(s.scoring.bands.high > s.scoring.bands.good && s.scoring.bands.good > s.scoring.bands.review)) {
    throw new Error("Band thresholds must satisfy high > good > review");
  }
  await setSetting(db, "app", s);
  return s;
}

/** Hash of everything that influences a score. A change forces re-scoring on the next run. */
export function scoringFingerprint(profile: Profile, settings: AppSettings): string {
  return sha256(
    JSON.stringify({
      skills: profile.skills,
      weights: profile.weights,
      years: profile.yearsExperience,
      titles: profile.preferredTitles,
      salary: profile.salary,
      prefs: profile.preferences,
      country: profile.countryOfResidence,
      achievements: profile.achievements,
      search: settings.search,
      bands: settings.scoring.bands,
    }),
  );
}
