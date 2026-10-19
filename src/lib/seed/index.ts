import type { Db } from "../db/types";
import { getSetting, setSetting } from "../db/settings";
import { DEFAULT_SETTINGS } from "../config/schema";
import { DEFAULT_PROFILE } from "../config/defaultProfile";
import { listSources, upsertSource } from "../db/sources";
import { loadProfile, loadSettings, scoringFingerprint } from "../db/config";
import { enrichJob } from "../jobs/enrich";
import { ingestJob, rescoreStale } from "../pipeline/ingest";
import { syntheticJobs } from "./synthetic";

/** Sources verified with live requests during development (see docs/SOURCES.md). Added once; deleting them sticks. */
export const DEFAULT_SOURCES = [
  {
    id: "greenhouse:gitlab", kind: "greenhouse", name: "GitLab (Greenhouse)",
    config: { boardToken: "gitlab", companyName: "GitLab", titleKeywords: ["backend", "back-end", "java", "software engineer", "platform", "integration", "api", "full stack", "full-stack", "developer", "microservice"] },
  },
  {
    id: "lever:spotify", kind: "lever", name: "Spotify (Lever)",
    config: { site: "spotify", companyName: "Spotify", region: "global", titleKeywords: ["backend", "back-end", "java", "software engineer", "platform", "integration", "api", "full stack", "full-stack", "developer", "microservice"] },
  },
];

export async function seedSyntheticJobs(db: Db): Promise<number> {
  const profile = await loadProfile(db);
  const settings = await loadSettings(db);
  const now = new Date().toISOString();
  const env = { profile, settings, fingerprint: scoringFingerprint(profile, settings), nowIso: now, runStartIso: now };
  let n = 0;
  await db.transaction(async (tx) => {
    for (const j of syntheticJobs()) {
      const out = await ingestJob(tx, enrichJob(j), env);
      if (out.kind === "new" || out.kind === "review") n++;
    }
    await rescoreStale(tx, env);
  });
  return n;
}

export async function ensureDefaults(db: Db): Promise<void> {
  if (!(await getSetting(db, "profile"))) await setSetting(db, "profile", DEFAULT_PROFILE);
  if (!(await getSetting(db, "app"))) await setSetting(db, "app", DEFAULT_SETTINGS);
  if (!(await getSetting(db, "seeded_sources"))) {
    const existing = new Set((await listSources(db)).map((s) => s.id));
    for (const s of DEFAULT_SOURCES) if (!existing.has(s.id)) await upsertSource(db, s);
    await setSetting(db, "seeded_sources", true);
  }
  if (!(await getSetting(db, "seeded_synthetic")) && process.env.SEED_SYNTHETIC !== "false") {
    await seedSyntheticJobs(db);
    await setSetting(db, "seeded_synthetic", true);
  }
}
