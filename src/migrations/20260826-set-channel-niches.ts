import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { env } from "../config/env";
import { connectToDatabase, disconnectFromDatabase } from "../infrastructure/db/mongoose";

/**
 * Assigns (corrects) the niche lock on specific channels to the canonical
 * NicheProfile.profileId that the create-project form / lock compare against.
 *
 *   STORyFun (ST0RyFun) -> philippine_history   (was: science)
 *   PsychoVault         -> psychology           (was: unset)
 *
 * Safety:
 *  - Only ever runs $set on `channels.nicheId`, in place. Never deletes a
 *    document, never renames a collection, never touches projects/stories.
 *  - Refuses to write a niche that does not resolve to a canonical profileId
 *    (validated against nicheprofiles, falling back to config/niches.json).
 *  - Idempotent: a channel already on the target id is skipped.
 *  - Reports projects attached to each channel and warns on a niche conflict,
 *    so a mismatch is never introduced silently.
 *
 * Preview (no writes):
 *   MONGODB_URI="mongodb://localhost:27018/youtube_shorts_automation" DRY_RUN=1 npm run migrate:set-channel-niches
 * Apply:
 *   MONGODB_URI="mongodb://localhost:27018/youtube_shorts_automation" npm run migrate:set-channel-niches
 */

const DRY_RUN = process.env.DRY_RUN === "1" || process.argv.includes("--dry");

// Match is case-insensitive against the channel title, with look-alike digits
// folded (0->o, 1->i) so the stored "ST0RyFun" matches "storyfun".
const TARGETS: Array<{ titleContains: string; niche: string }> = [
  { titleContains: "storyfun", niche: "philippine history" },
  { titleContains: "psychovault", niche: "psychology" }
];

const foldTitle = (value: string): string =>
  value.toLowerCase().replace(/0/g, "o").replace(/1/g, "i").replace(/[^a-z0-9]/g, "");

const normNiche = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_");

const run = async () => {
  await connectToDatabase(env.MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is unavailable.");

  console.info(`Connected to DB: ${db.databaseName}`);
  console.info(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "APPLYING CHANGES"}\n`);

  // 1) Build the canonical niche resolver (profileId is the compared value).
  type NicheRow = { profileId?: unknown; slug?: unknown; name?: unknown };
  let nicheRows: NicheRow[] = await db.collection("nicheprofiles").find({}).toArray();

  if (nicheRows.length === 0) {
    // Fallback: the same source the app seeds from.
    const jsonPath = path.resolve(process.cwd(), "config/niches.json");
    if (fs.existsSync(jsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const list = Array.isArray(parsed) ? parsed : parsed?.niches;
      if (Array.isArray(list)) {
        nicheRows = list.map((n: { id?: unknown; name?: unknown }) => ({
          profileId: n.id,
          slug: String(n.id ?? "").replaceAll("_", "-"),
          name: n.name
        }));
      }
    }
  }

  if (nicheRows.length === 0) {
    throw new Error("No niche profiles found in DB or config/niches.json; cannot resolve canonical niche ids.");
  }

  const canonical = new Set<string>();
  const byKey = new Map<string, string>();
  for (const row of nicheRows) {
    const profileId = String(row.profileId ?? "");
    if (!profileId) continue;
    canonical.add(profileId);
    byKey.set(normNiche(profileId), profileId);
    if (row.slug) byKey.set(normNiche(String(row.slug)), profileId);
    if (row.name) byKey.set(normNiche(String(row.name)), profileId);
  }
  const resolveNiche = (raw: string): string | null => byKey.get(normNiche(raw)) ?? null;

  console.info(`Canonical niche profileIds: ${JSON.stringify([...canonical])}\n`);

  const channelsCol = db.collection("channels");
  const projectsCol = db.collection("projects");
  const channels = await channelsCol.find({}).toArray();

  let planned = 0;
  let applied = 0;

  for (const target of TARGETS) {
    const targetProfileId = resolveNiche(target.niche);
    if (!targetProfileId) {
      console.error(`  ✗ Niche "${target.niche}" does not resolve to a canonical profileId. Available: ${JSON.stringify([...canonical])}`);
      console.error(`    Refusing to write an unknown niche id for "${target.titleContains}".\n`);
      continue;
    }

    const matches = channels.filter((c) => foldTitle(String(c.title ?? "")).includes(target.titleContains));
    if (matches.length === 0) {
      console.warn(`  ! No channel title matched "${target.titleContains}". Titles present: ${JSON.stringify(channels.map((c) => c.title))}\n`);
      continue;
    }

    for (const channel of matches) {
      const current = channel.nicheId === undefined ? "(unset)" : JSON.stringify(channel.nicheId);
      const accountKeys = [String(channel._id), String(channel.externalChannelId ?? "")].filter((v) => v.length > 0);
      const attached = await projectsCol
        .find({ accountId: { $in: accountKeys } }, { projection: { title: 1, nicheId: 1 } })
        .toArray();
      const projectNiches = [...new Set(attached.map((p) => JSON.stringify(p.nicheId)))];

      console.info(`  Channel "${channel.title}"  (extId=${channel.externalChannelId})`);
      console.info(`     nicheId: ${current}  ->  ${JSON.stringify(targetProfileId)}`);
      console.info(`     nicheLockExempt: ${JSON.stringify(channel.nicheLockExempt ?? false)}`);
      if (attached.length > 0) {
        console.info(`     attached projects (${attached.length}): niches=${JSON.stringify(projectNiches)}`);
        const conflicting = attached.filter((p) => p.nicheId && p.nicheId !== targetProfileId);
        if (conflicting.length > 0) {
          console.warn(`     ⚠ ${conflicting.length} attached project(s) hold a DIFFERENT niche than the target: ${JSON.stringify(conflicting.map((p) => p.title))}`);
        }
      } else {
        console.info(`     attached projects: none found by accountId in ${JSON.stringify(accountKeys)}`);
      }

      if (channel.nicheId === targetProfileId) {
        console.info(`     = already on target; skipping.\n`);
        continue;
      }

      planned++;
      if (DRY_RUN) {
        console.info(`     (dry run — would update)\n`);
      } else {
        await channelsCol.updateOne({ _id: channel._id }, { $set: { nicheId: targetProfileId } });
        applied++;
        console.info(`     ✓ updated.\n`);
      }
    }
  }

  console.info(`Summary: ${DRY_RUN ? `would change ${planned}` : `changed ${applied}`} channel(s). No documents deleted; only nicheId set in place.`);
  await disconnectFromDatabase();
};

void run().catch(async (error) => {
  console.error(error);
  await disconnectFromDatabase().catch(() => undefined);
  process.exitCode = 1;
});
