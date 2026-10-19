import { z } from "zod";
import type { SourceAdapter, VerifyResult } from "@/lib/sources/types";
import type { NormalizedJobInput } from "@/lib/jobs/types";
import { HttpError } from "@/lib/sources/retry";
import { upsertSource } from "@/lib/db/sources";
import type { Db } from "@/lib/db/types";

export const GOOD_DESC = `
About the role
Join our telecom payments platform team building Spring Boot microservices for recharge transactions.

Requirements
- 2-4 years of experience with Java and Spring Boot
- REST APIs, third-party integrations, MySQL and SQL, Spring Data JPA / Hibernate
- Docker, Maven, Linux and CI/CD pipelines
- JUnit and Mockito for unit testing; production troubleshooting

Nice to have
- Elasticsearch
`;

export interface FakeState {
  jobs: NormalizedJobInput[];
  /** If set, fetchJobs throws this until cleared. */
  fail: Error | null;
  failTimes: number;
  fetchCalls: number;
  /** verifyJob results by sourceJobId. Default: open=null (inconclusive). */
  verify: Record<string, boolean | null>;
  verifyCalls: string[];
}

export function makeJob(id: string, over: Partial<NormalizedJobInput> = {}): NormalizedJobInput {
  return {
    sourceKey: "fake:x",
    sourceKind: "fake",
    sourceJobId: id,
    title: "Java Backend Engineer",
    company: "Acme",
    applyUrl: `https://careers.acme.test/jobs/${id}`,
    descriptionText: GOOD_DESC,
    locationRaw: "Remote - Worldwide",
    postedAt: "2026-10-15T00:00:00Z",
    ...over,
  };
}

export function fakeAdapter(state: FakeState, kind = "fake"): SourceAdapter {
  return {
    kind,
    info: { kind, title: "Fake", setup: "", access: "", limits: "", attribution: "", fields: [], docsUrl: "", scheduled: true },
    configSchema: z.object({ titleKeywords: z.array(z.string()).optional() }).passthrough(),
    sourceKey: () => `${kind}:x`,
    async fetchJobs() {
      state.fetchCalls++;
      if (state.fail && (state.failTimes === Infinity || state.fetchCalls <= state.failTimes)) throw state.fail;
      return { jobs: state.jobs.map((j) => ({ ...j, sourceKey: `${kind}:x`, sourceKind: kind })), complete: true, httpStatus: 200, totalListed: state.jobs.length, seenIds: state.jobs.map((j) => j.sourceJobId), notes: [] };
    },
    async verifyJob(_c, id): Promise<VerifyResult> {
      state.verifyCalls.push(id);
      const v = state.verify[id] ?? null;
      return { open: v, evidence: `fake verify ${id} → ${v}`, httpStatus: v === false ? 404 : v ? 200 : 500 };
    },
  };
}

export const newState = (jobs: NormalizedJobInput[] = []): FakeState => ({ jobs, fail: null, failTimes: Infinity, fetchCalls: 0, verify: {}, verifyCalls: [] });

export async function addFakeSource(db: Db, config: Record<string, unknown> = {}, kind = "fake") {
  await upsertSource(db, { id: `${kind}:x`, kind, name: "Fake source", config });
}

export const serverError = () => new HttpError("HTTP 503 from fake", 503);

export function clock(startIso = "2026-10-19T04:00:00Z") {
  let t = new Date(startIso).getTime();
  return { now: () => new Date(t), advanceHours: (h: number) => void (t += h * 3600_000), advanceDays: (d: number) => void (t += d * 86_400_000) };
}
