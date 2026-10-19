import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { outboxProvider, providerFromEnv, resendProvider, smtpProvider, fromAddress } from "@/lib/notify/providers";
import { maskEmail, redact } from "@/lib/util";
import { testDb } from "./helpers/db";
import { logDelivery } from "@/lib/notify/stage";
import { writeLogs, createRun, getRunLogs } from "@/lib/db/runs";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const MSG = { to: "me@example.com", from: "Job Hunter <jobs@example.com>", subject: "3 matches", html: "<p>hi</p>", text: "hi" };

describe("email providers", () => {
  it("SMTP provider builds a correct message through a real nodemailer transport (no network)", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const p = smtpProvider(env({}), transport);
    const r = await p.send(MSG);
    expect(p.deliversExternally).toBe(true);
    expect(r.id).toBeTruthy();
    // jsonTransport exposes the message nodemailer would have sent
    const info: any = await transport.sendMail({ ...MSG });
    const sent = JSON.parse(info.message);
    expect(sent).toMatchObject({ subject: "3 matches", html: "<p>hi</p>", text: "hi" });
    expect(sent.to[0].address).toBe("me@example.com");
    expect(sent.from.address).toBe("jobs@example.com");
  });

  it("SMTP provider propagates transport failures", async () => {
    const bad = { sendMail: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNECTION" }); } } as any;
    await expect(smtpProvider(env({}), bad).send(MSG)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("requires explicit configuration", () => {
    expect(() => smtpProvider(env({}))).toThrow(/SMTP_HOST/);
    expect(() => resendProvider(env({}))).toThrow(/RESEND_API_KEY/);
    expect(() => providerFromEnv(env({ EMAIL_PROVIDER: "resend" }))).toThrow();
  });

  it("Resend provider posts the expected payload with bearer auth and never leaks the key in errors", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const ok = (async (url: any, init: any) => { seen = { url: String(url), init }; return new Response(JSON.stringify({ id: "re_123" }), { status: 200 }); }) as typeof fetch;
    const p = resendProvider(env({ RESEND_API_KEY: "re_SECRETKEY123" }), ok);
    expect(await p.send(MSG)).toEqual({ id: "re_123" });
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect((seen!.init.headers as any).authorization).toBe("Bearer re_SECRETKEY123");
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ to: ["me@example.com"], subject: "3 matches" });

    const fail = (async () => new Response("denied", { status: 401 })) as typeof fetch;
    const err: any = await resendProvider(env({ RESEND_API_KEY: "re_SECRETKEY123" }), fail).send(MSG).catch((e) => e);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain("SECRETKEY");
  });

  it("defaults to the outbox provider, which delivers nothing externally", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-"));
    expect(providerFromEnv(env({})).deliversExternally).toBe(false);
    const r = await outboxProvider(dir).send(MSG);
    expect(fs.existsSync(r.location!)).toBe(true);
    expect(fs.readFileSync(r.location!, "utf8")).toBe("<p>hi</p>");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("has a sane default From address", () => {
    expect(fromAddress(env({}))).toContain("Job Hunter");
    expect(fromAddress(env({ EMAIL_FROM: "x@y.z" }))).toBe("x@y.z");
  });
});

describe("log redaction", () => {
  it("masks secrets and addresses", () => {
    expect(redact("failed with api_key=sk-abc123 for me@example.com")).toBe("failed with api_key=[redacted] for m***@example.com");
    expect(redact('{"password":"hunter2hunter2","token": "abc"}')).not.toMatch(/hunter2|abc/);
    expect(redact("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def.ghi");
    expect(maskEmail("someone@corp.example")).toBe("s***@corp.example");
  });

  it("run logs are redacted before they are stored", async () => {
    const db = await testDb();
    const runId = await createRun(db, { trigger: "manual", dryRun: false, params: {}, startedAt: new Date().toISOString() });
    await writeLogs(db, runId, [{ ts: new Date().toISOString(), level: "error", message: "SMTP auth failed: password=SuperSecret99 user bob@corp.example" }]);
    const logs = await getRunLogs(db, runId);
    expect(logs[0].message).not.toMatch(/SuperSecret99|bob@/);
    expect(logs[0].message).toContain("[redacted]");
  });

  it("delivery-log errors are redacted and the recipient is masked", async () => {
    const db = await testDb();
    await logDelivery(db, { kind: "digest", provider: "smtp", recipient: "me@example.com", subject: "s", status: "failed", error: "535 auth failed password=Hunter2Hunter2 for me@example.com", now: new Date() });
    const row = (await db.query("SELECT recipient, error FROM notification_log"))[0];
    expect(row.recipient).toBe("m***@example.com");
    expect(row.error).not.toMatch(/Hunter2|me@example/);
  });
});
