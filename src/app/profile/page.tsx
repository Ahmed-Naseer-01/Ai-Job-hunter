import { getDb } from "@/lib/db";
import { loadProfile } from "@/lib/db/config";
import { TAXONOMY } from "@/lib/extract/taxonomy";
import { ProfileForm } from "@/components/ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await loadProfile(await getDb());
  return (
    <>
      <h1>Profile</h1>
      <p className="lead">The source of truth for matching. Saving re-scores every job with your changes. Nothing here is sent to any external service.</p>
      <ProfileForm initial={profile} skillOptions={TAXONOMY.map((s) => ({ id: s.id, label: s.label }))} />
    </>
  );
}
