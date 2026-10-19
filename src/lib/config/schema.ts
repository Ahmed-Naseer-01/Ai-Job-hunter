import { z } from "zod";

export const SKILL_LEVELS = ["expert", "strong", "working", "familiar"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number] | "none";

export const WeightsSchema = z.object({
  javaSpring: z.number().min(0).max(100),
  backendMicroservices: z.number().min(0).max(100),
  dataApi: z.number().min(0).max(100),
  opsTooling: z.number().min(0).max(100),
  seniorityFit: z.number().min(0).max(100),
  eligibility: z.number().min(0).max(100),
  preferences: z.number().min(0).max(100),
});
export type Weights = z.infer<typeof WeightsSchema>;

export const DEFAULT_WEIGHTS: Weights = {
  javaSpring: 25,
  backendMicroservices: 20,
  dataApi: 15,
  opsTooling: 10,
  seniorityFit: 10,
  eligibility: 10,
  preferences: 10,
};

export const ProfileSkillSchema = z.object({
  id: z.string().min(1), // taxonomy id, e.g. "spring-boot"
  level: z.enum(SKILL_LEVELS),
  note: z.string().optional(),
});

export const ExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  start: z.string(), // YYYY-MM
  end: z.string().nullable(), // null = present
  highlights: z.array(z.string()),
  /** Engagements inside the same employment (e.g. AsiaCell) must not add duration. */
  withinEmployment: z.boolean().default(false),
});

export const AchievementSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** taxonomy skill ids / domain tags this achievement is evidence for */
  tags: z.array(z.string()),
});

export const ProfileSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().or(z.literal("")),
  location: z.string(),
  countryOfResidence: z.string().min(2),
  currentTitle: z.string(),
  /** Professional years of experience used for seniority fit. Not auto-derived to avoid double counting. */
  yearsExperience: z.number().min(0).max(40),
  summary: z.string(),
  resumeText: z.string(),
  preferredTitles: z.array(z.string()),
  skills: z.array(ProfileSkillSchema),
  experience: z.array(ExperienceSchema),
  achievements: z.array(AchievementSchema),
  salary: z.object({
    min: z.number().nullable(),
    currency: z.string().length(3).or(z.literal("")),
    period: z.enum(["year", "month"]),
  }),
  preferences: z.object({
    remoteOnly: z.boolean(),
    avoidCompanies: z.array(z.string()),
    avoidKeywords: z.array(z.string()),
  }),
  weights: WeightsSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

export const AppSettingsSchema = z.object({
  search: z.object({
    includeOnsitePakistan: z.boolean(),
    includeHybridPakistan: z.boolean(),
    includeRelocation: z.boolean(),
    includeContract: z.boolean(),
    includeInternships: z.boolean(),
    showSynthetic: z.boolean(),
  }),
  scoring: z.object({
    bands: z.object({ high: z.number(), good: z.number(), review: z.number() }),
  }),
  schedule: z.object({
    enabled: z.boolean(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm"),
    timezone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown IANA timezone"),
    lookbackDays: z.number().int().min(1).max(365),
    minMatchScore: z.number().min(0).max(100),
    maxNotificationsPerDay: z.number().int().min(0).max(100),
    dryRun: z.boolean(),
    closeAfterMissedRuns: z.number().int().min(1).max(30),
    reminderDays: z.number().int().min(0).max(90),
    /** Include "potentially eligible" roles in the digest (ineligible never are). */
    notifyPotentiallyEligible: z.boolean(),
  }),
  email: z.object({
    enabled: z.boolean(),
    to: z.string(),
  }),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  search: {
    includeOnsitePakistan: false,
    includeHybridPakistan: false,
    includeRelocation: false,
    includeContract: false,
    includeInternships: false,
    showSynthetic: true,
  },
  scoring: { bands: { high: 85, good: 70, review: 50 } },
  schedule: {
    enabled: true,
    time: "08:00",
    timezone: "Asia/Karachi",
    lookbackDays: 30,
    minMatchScore: 70,
    maxNotificationsPerDay: 10,
    dryRun: false,
    closeAfterMissedRuns: 2,
    reminderDays: 0,
    notifyPotentiallyEligible: true,
  },
  email: { enabled: false, to: "ahmed.naseer.contact@gmail.com" },
};
