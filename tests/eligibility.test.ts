import { describe, it, expect } from "vitest";
import { evaluateEligibility, type EligibilityInput } from "@/lib/matching/eligibility";
import { DEFAULT_SETTINGS } from "@/lib/config/schema";

const base: EligibilityInput = { title: "Backend Engineer", locationRaw: null, workMode: "unknown", employmentType: "full_time", description: "" };
const search = DEFAULT_SETTINGS.search;
const ev = (over: Partial<EligibilityInput>, s: Partial<typeof search> = {}) =>
  evaluateEligibility({ ...base, ...over }, { countryOfResidence: "Pakistan" }, { ...search, ...s });

describe("eligibility: remote jobs", () => {
  it("accepts explicit worldwide remote", () => {
    const r = ev({ locationRaw: "Remote - Worldwide", workMode: "remote" });
    expect(r.state).toBe("eligible");
    expect(r.evidence.join(" ")).toMatch(/Worldwide/i);
  });
  it("accepts remote Pakistan", () => {
    expect(ev({ locationRaw: "Remote - Pakistan", workMode: "remote" }).state).toBe("eligible");
  });
  it("does NOT treat a bare 'Remote' title as eligible", () => {
    const r = ev({ locationRaw: "Remote", workMode: "remote" });
    expect(r.state).toBe("potential");
    expect(r.requiresConfirmation.length).toBeGreaterThan(0);
  });
  it.each(["Remote - US", "Remote, United States", "US Remote", "Remote - Canada", "Remote (EMEA)", "Remote - Europe", "Remote - Germany", "Remote - India", "Remote - LATAM", "Remote - UK"])(
    "rejects geography-restricted remote: %s",
    (loc) => {
      expect(ev({ locationRaw: loc, workMode: "remote" }).state).toBe("ineligible");
    },
  );
  it("treats APAC / Asia remote as potentially eligible", () => {
    expect(ev({ locationRaw: "Remote - APAC", workMode: "remote" }).state).toBe("potential");
  });
  it("accepts a list that includes Pakistan", () => {
    expect(ev({ locationRaw: "Remote - US, Canada or Pakistan", workMode: "remote" }).state).toBe("eligible");
  });
});

describe("eligibility: description restrictions override a generic remote location", () => {
  it("US work authorization requirement", () => {
    const r = ev({ locationRaw: "Remote", workMode: "remote", description: "You must be authorized to work in the United States without sponsorship." });
    expect(r.state).toBe("ineligible");
    expect(r.evidence.join(" ")).toMatch(/authorized to work in the United States/i);
  });
  it("must be located in", () => {
    expect(ev({ locationRaw: "Remote", workMode: "remote", description: "Candidates must be located in the UK or Ireland." }).state).toBe("ineligible");
  });
  it("must be located in a list including Pakistan is fine", () => {
    expect(ev({ locationRaw: "Remote", workMode: "remote", description: "Candidates must be located in the US, Canada or Pakistan." }).state).toBe("eligible");
  });
  it("residents only", () => {
    expect(ev({ locationRaw: "Remote", workMode: "remote", description: "This role is open to residents of the US and Canada only." }).state).toBe("ineligible");
  });
  it("citizenship / clearance", () => {
    expect(ev({ locationRaw: "Remote", workMode: "remote", description: "Active security clearance required." }).state).toBe("ineligible");
    expect(ev({ locationRaw: "Remote", workMode: "remote", description: "Must be a U.S. citizen." }).state).toBe("ineligible");
  });
  it("explicit global hiring statement", () => {
    expect(ev({ locationRaw: "Remote", workMode: "remote", description: "We are fully distributed and hire anywhere in the world." }).state).toBe("eligible");
  });
  it("time-zone overlap requirement needs confirmation", () => {
    const r = ev({ locationRaw: "Remote - Worldwide", workMode: "remote", description: "You must overlap with US Eastern time zone working hours." });
    expect(r.state).toBe("potential");
    expect(r.requiresConfirmation.join(" ")).toMatch(/time[- ]?zone/i);
  });
  it("no sponsorship alone does not make a remote job ineligible", () => {
    const r = ev({ locationRaw: "Remote", workMode: "remote", description: "We cannot sponsor visas." });
    expect(r.state).toBe("potential");
  });
});

describe("eligibility: on-site / hybrid", () => {
  it("on-site abroad is ineligible by default", () => {
    expect(ev({ locationRaw: "Berlin, Germany", workMode: "onsite" }).state).toBe("ineligible");
    expect(ev({ locationRaw: "Springfield", workMode: "onsite" }).state).toBe("ineligible");
  });
  it("relocation enabled -> potential only when sponsorship/relocation is offered", () => {
    expect(ev({ locationRaw: "Berlin, Germany", workMode: "onsite", description: "We offer visa sponsorship and relocation support." }, { includeRelocation: true }).state).toBe("potential");
    expect(ev({ locationRaw: "Berlin, Germany", workMode: "onsite", description: "No visa sponsorship available." }, { includeRelocation: true }).state).toBe("ineligible");
  });
  it("Pakistan on-site is eligible but excluded by preference unless enabled", () => {
    const off = ev({ locationRaw: "Lahore, Pakistan", workMode: "onsite" });
    expect(off.state).toBe("eligible");
    expect(off.preferenceExcluded).toMatch(/on-site/i);
    expect(ev({ locationRaw: "Lahore, Pakistan", workMode: "onsite" }, { includeOnsitePakistan: true }).preferenceExcluded).toBeNull();
  });
  it("Pakistan hybrid follows the hybrid setting", () => {
    expect(ev({ locationRaw: "Lahore", workMode: "hybrid", description: "Based in Lahore, Pakistan" }).preferenceExcluded).toMatch(/hybrid/i);
    expect(ev({ locationRaw: "Karachi, Pakistan", workMode: "hybrid" }, { includeHybridPakistan: true }).preferenceExcluded).toBeNull();
  });
});

describe("eligibility: employment type preferences", () => {
  it("excludes contract and internships unless enabled", () => {
    const r = { locationRaw: "Remote - Worldwide", workMode: "remote" as const };
    expect(ev({ ...r, employmentType: "contract" }).preferenceExcluded).toMatch(/contract/i);
    expect(ev({ ...r, employmentType: "contract" }, { includeContract: true }).preferenceExcluded).toBeNull();
    expect(ev({ ...r, employmentType: "internship" }).preferenceExcluded).toMatch(/intern/i);
    expect(ev({ ...r, employmentType: "internship" }, { includeInternships: true }).preferenceExcluded).toBeNull();
    expect(ev({ ...r, employmentType: "unknown" }).preferenceExcluded).toBeNull();
  });
});

describe("eligibility: unknowns", () => {
  it("no location info at all is potential", () => {
    expect(ev({}).state).toBe("potential");
  });
  it("reports detected countries", () => {
    expect(ev({ locationRaw: "Remote - Germany", workMode: "remote" }).countries).toContain("Germany");
  });
});
