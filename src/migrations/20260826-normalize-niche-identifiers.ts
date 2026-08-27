import mongoose from "mongoose";
import { env } from "../config/env";
import { connectToDatabase, disconnectFromDatabase } from "../infrastructure/db/mongoose";

/**
 * Normalizes legacy / drifted niche identifiers to the canonical
 * `NicheProfile.profileId` on both the `channels` and `projects` collections.
 *
 * Why: the niche lock (channel.nicheId) and the create-project form compare the
 * stored identifier against the current profileId with exact string equality.
 * If a channel/project was locked under an older identifier form (hyphenated
 * slug, legacy Mongo id, display name, different casing), it no longer matches
 * the slug served today and the account is wrongly shown as "dedicated to
 * another niche".
 *
 * Safety:
 *  - Updates ONLY the `nicheId` string, in place. Never deletes documents,
 *    never renames collections, never detaches connected stories/projects.
 *  - Only rewrites a value when it resolves to exactly one canonical profileId.
 *    Anything ambiguous or unknown is left untouched and logged for review.
 *  - Idempotent: values that are already canonical are skipped.
 *  - Refuses to run if there are no niche profiles (would risk unmapping data).
 *
 * Preview without writing:
 *   DRY_RUN=1 npm run migrate:normalize-niche-ids
 * Apply:
 *   npm run migrate:normalize-niche-ids
 */

const DRY_RUN = process.env.DRY_RUN === "1" || process.argv.includes("--dry");

const normalize = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_");

const isObjectIdLike = (value: string): boolean => /^[a-f0-9]{24}$/i.test(value);

const run = async () => {
  await connectToDatabase(env.MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is unavailable.");

  const nicheDocs = await db.collection("nicheprofiles").find({}).toArray();
  if (nicheDocs.length === 0) {
    throw new Error("No niche profiles found; refusing to run so no identifier is accidentally unmapped.");
  }

  const canonical = new Set<string>();
  const bySlug = new Map<string, string>();
  const byName = new Map<string, string>();
  const byObjectId = new Map<string, string>();
  const byNormalized = new Map<string, string>();

  for (const niche of nicheDocs) {
    const profileId = String(niche.profileId);
    canonical.add(profileId);
    byObjectId.set(String(niche._id), profileId);
    byNormalized.set(normalize(profileId), profileId);
    if (niche.slug) {
      bySlug.set(String(niche.slug), profileId);
      byNormalized.set(normalize(String(niche.slug)), profileId);
    }
    if (niche.name) {
      byName.set(String(niche.name).toLowerCase(), profileId);
      byNormalized.set(normalize(String(niche.name)), profileId);
    }
  }

  const resolve = (raw: unknown): string | null => {
    if (typeof raw !== "string" || raw.length === 0) return null;
    if (canonical.has(raw)) return raw; // already canonical
    if (bySlug.has(raw)) return bySlug.get(raw)!; // hyphenated slug form
    if (isObjectIdLike(raw) && byObjectId.has(raw)) return byObjectId.get(raw)!; // legacy Mongo id reference
    if (byName.has(raw.toLowerCase())) return byName.get(raw.toLowerCase())!; // display name
    const normalized = byNormalized.get(normalize(raw));
    return normalized ?? null; // hyphen / space / casing variants
  };

  const fixCollection = async (name: string) => {
    const collection = db.collection(name);
    const docs = await collection.find({ nicheId: { $exists: true, $nin: [null, ""] } }).toArray();
    let changed = 0;
    let already = 0;
    let unresolved = 0;

    for (const doc of docs) {
      const raw = doc.nicheId as string;
      const target = resolve(raw);
      if (target === null) {
        unresolved++;
        console.warn(`  [${name}] UNRESOLVED _id=${doc._id} nicheId=${JSON.stringify(raw)} — left unchanged for manual review`);
        continue;
      }
      if (target === raw) {
        already++;
        continue;
      }
      console.info(`  [${name}] ${DRY_RUN ? "WOULD FIX" : "FIX"} _id=${doc._id} ${JSON.stringify(raw)} -> ${JSON.stringify(target)}`);
      if (!DRY_RUN) await collection.updateOne({ _id: doc._id }, { $set: { nicheId: target } });
      changed++;
    }

    console.info(`  [${name}] ${DRY_RUN ? "would change" : "changed"}=${changed}  alreadyCanonical=${already}  unresolved=${unresolved}  scanned=${docs.length}`);
  };

  console.info(`Niche identifier normalization ${DRY_RUN ? "(DRY RUN — no writes)" : "(APPLYING CHANGES)"}`);
  console.info(`Canonical profileIds: ${JSON.stringify([...canonical])}`);
  await fixCollection("channels");
  await fixCollection("projects");
  console.info("Done. No documents were deleted; only nicheId strings were normalized in place.");

  await disconnectFromDatabase();
};

void run().catch(async (error) => {
  console.error(error);
  await disconnectFromDatabase().catch(() => undefined);
  process.exitCode = 1;
});
