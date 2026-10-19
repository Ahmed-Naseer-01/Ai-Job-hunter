import fs from "node:fs";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { newId } from "../util";

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  id?: string;
  /** For the outbox provider: where the preview was written. */
  location?: string;
}

export interface EmailProvider {
  name: "outbox" | "smtp" | "resend" | "memory";
  /** True when messages actually leave this machine. */
  deliversExternally: boolean;
  send(msg: EmailMessage): Promise<SendResult>;
}

/** Writes each message to ./data/outbox as .html and .txt. Sends nothing. The safe default. */
export function outboxProvider(dir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "data", "outbox")): EmailProvider {
  return {
    name: "outbox",
    deliversExternally: false,
    async send(msg) {
      fs.mkdirSync(dir, { recursive: true });
      const base = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${newId().slice(-6)}`);
      fs.writeFileSync(`${base}.html`, msg.html);
      fs.writeFileSync(`${base}.txt`, `To: ${msg.to}\nFrom: ${msg.from}\nSubject: ${msg.subject}\n\n${msg.text}`);
      return { id: path.basename(base), location: `${base}.html` };
    },
  };
}

/** In-memory provider for tests. */
export function memoryProvider(opts: { failTimes?: number } = {}): EmailProvider & { sent: EmailMessage[]; attempts: number } {
  let failures = opts.failTimes ?? 0;
  const p = {
    name: "memory" as const,
    deliversExternally: true,
    sent: [] as EmailMessage[],
    attempts: 0,
    async send(msg: EmailMessage) {
      p.attempts++;
      if (failures > 0) {
        failures--;
        const e: any = new Error("temporary provider failure");
        e.status = 503;
        throw e;
      }
      p.sent.push(msg);
      return { id: `mem-${p.sent.length}` };
    },
  };
  return p;
}

export function smtpProvider(env: NodeJS.ProcessEnv = process.env, transportOverride?: Transporter): EmailProvider {
  const host = env.SMTP_HOST;
  if (!transportOverride && !host) throw new Error("SMTP_HOST is not set");
  const transport =
    transportOverride ??
    nodemailer.createTransport({
      host,
      port: Number(env.SMTP_PORT ?? 587),
      secure: env.SMTP_SECURE === "true",
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
    });
  return {
    name: "smtp",
    deliversExternally: true,
    async send(msg) {
      const info = await transport.sendMail({ from: msg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
      return { id: String(info.messageId ?? "") };
    },
  };
}

export function resendProvider(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): EmailProvider {
  const key = env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return {
    name: "resend",
    deliversExternally: true,
    async send(msg) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      });
      if (!res.ok) {
        const e: any = new Error(`Resend responded HTTP ${res.status}`);
        e.status = res.status;
        throw e;
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { id: body.id };
    },
  };
}

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  switch ((env.EMAIL_PROVIDER ?? "outbox").toLowerCase()) {
    case "smtp":
      return smtpProvider(env);
    case "resend":
      return resendProvider(env);
    case "outbox":
    default:
      return outboxProvider();
  }
}

export const fromAddress = (env: NodeJS.ProcessEnv = process.env) => env.EMAIL_FROM || "Job Hunter <jobs@localhost>";
