import { route, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { sendTestEmail, ValidationError } from "@/lib/services/actions";
import { providerFromEnv } from "@/lib/notify/providers";

export const dynamic = "force-dynamic";

/** Requires {"confirm": true} when the provider delivers outside this machine: external actions need explicit approval. */
export const POST = route(async (req: Request) => {
  const body = (await readJson(req)) as { confirm?: boolean; to?: string };
  const provider = providerFromEnv();
  if (provider.deliversExternally && body.confirm !== true) throw new ValidationError(`Sending through "${provider.name}" delivers a real email. Resend with confirm: true to approve.`);
  return sendTestEmail(await getDb(), { provider, to: body.to });
});
