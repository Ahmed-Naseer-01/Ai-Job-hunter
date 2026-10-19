import type { JobFilters } from "../services/queries";
import { intParam } from "../api";

type P = Record<string, string | string[] | undefined> | URLSearchParams;
const get = (p: P, k: string): string | undefined => {
  const v = p instanceof URLSearchParams ? p.get(k) ?? undefined : p[k];
  return Array.isArray(v) ? v[0] : v || undefined;
};

export function filtersFromParams(p: P, defaults: Partial<JobFilters> = {}): JobFilters {
  const sort = get(p, "sort");
  return {
    ...defaults,
    q: get(p, "q"),
    minScore: intParam(get(p, "minScore")),
    band: get(p, "band"),
    eligibility: get(p, "eligibility"),
    workMode: get(p, "workMode"),
    seniority: get(p, "seniority"),
    employmentType: get(p, "employmentType"),
    country: get(p, "country"),
    source: get(p, "source"),
    skill: get(p, "skill"),
    minSalary: intParam(get(p, "minSalary")),
    postedWithinDays: intParam(get(p, "postedWithinDays")),
    status: get(p, "status") ?? defaults.status,
    appStatus: get(p, "appStatus"),
    sort: sort === "posted" || sort === "seen" || sort === "company" || sort === "score" ? sort : defaults.sort,
    page: intParam(get(p, "page")),
    pageSize: intParam(get(p, "pageSize")) ?? defaults.pageSize,
  };
}
