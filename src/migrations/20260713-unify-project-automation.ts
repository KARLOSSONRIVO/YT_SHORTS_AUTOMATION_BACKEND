import crypto from "node:crypto";
import mongoose from "mongoose";
import { env } from "../config/env";
import { connectToDatabase, disconnectFromDatabase } from "../infrastructure/db/mongoose";
import { ProjectModel } from "../modules/models/project.model";
import { ProjectActivityModel } from "../modules/models/project-activity.model";

const sourceCollection = "nicheautomations";
const archiveCollection = "legacy_nicheautomations_archived_20260713";

const run = async () => {
  await connectToDatabase(env.MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is unavailable.");
  const collections = await db.listCollections().toArray();
  if (!collections.some((item: { name: string }) => item.name === sourceCollection)) {
    console.info("No legacy niche automation collection found; migration is already complete or not required.");
    await disconnectFromDatabase(); return;
  }

  const profiles = await db.collection(sourceCollection).find({}).toArray();
  const history = db.collection("contenthistories");
  for (const legacy of profiles) {
    const accountId = legacy.accountMappings?.find((mapping: { platform?: string }) => mapping.platform === "youtube")?.channelId;
    if (!accountId) continue;
    const project = await ProjectModel.findOneAndUpdate({ legacyAutomationId: legacy._id }, { $setOnInsert: {
      userId: legacy.userId, title: `${String(legacy.nicheId).replaceAll("_", " ")} daily stories`, projectType: "faceless_story",
      facelessSource: "daily_automation", legacyAutomationId: legacy._id, nicheId: legacy.nicheId, accountId,
      language: legacy.language ?? "en", timezone: legacy.timezone ?? "Asia/Manila", uploadTime: legacy.uploadTime ?? "19:00",
      durationSeconds: legacy.targetDurationSeconds ?? 60, targetDurationSeconds: legacy.targetDurationSeconds ?? 60,
      storyFormatMode: "auto_select", automationMode: legacy.automationMode ?? "approval_before_upload",
      automationEnabled: Boolean(legacy.enabled), automationStatus: legacy.enabled ? "active" : "paused", nextRunAt: legacy.nextRunAt,
      lastRunAt: legacy.lastRunAt, platforms: ["youtube"], status: "draft", workflowStage: "draft"
    } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    const legacyStories = await history.find({ automationId: legacy._id }).toArray();
    for (const story of legacyStories) {
      const createdAt = story.createdAt instanceof Date ? story.createdAt : new Date();
      const date = createdAt.toISOString().slice(0, 10);
      await history.updateOne({ _id: story._id }, { $set: {
        projectId: project._id, renderProjectId: story.projectId, legacyAutomationId: legacy._id,
        generationIdempotencyKey: story.generationIdempotencyKey ?? `${project.id}:${date}:generation:legacy:${story._id}`,
        uploadIdempotencyKey: story.uploadIdempotencyKey ?? crypto.createHash("sha256").update(`${project.id}:${date}:upload:legacy:${story._id}`).digest("hex"),
        generationAttempts: story.generationAttempts ?? 1
      }, $unset: { automationId: "" } });
    }
    await ProjectActivityModel.updateOne({ projectId: project._id, type: "legacy_migration" }, { $setOnInsert: {
      projectId: project._id, userId: project.userId, type: "legacy_migration", severity: "info",
      message: `Migrated ${legacyStories.length} existing story record(s) without regeneration or upload.`, metadata: { legacyAutomationId: legacy._id }
    } }, { upsert: true });
  }

  await ProjectModel.updateMany({ projectType: "faceless_story", facelessSource: { $in: ["topic", "reddit_trending"] }, parentProjectId: { $exists: false } },
    [{ $set: { legacySource: "$facelessSource", facelessSource: "archived_legacy", archivedLegacy: true, automationEnabled: false, automationStatus: "paused" } }]);
  if (!collections.some((item: { name: string }) => item.name === archiveCollection)) await db.collection(sourceCollection).rename(archiveCollection);
  console.info(`Migrated ${profiles.length} legacy automation profile(s); preserved manual stories as archived legacy content.`);
  await disconnectFromDatabase();
};

void run().catch(async (error) => { console.error(error); await disconnectFromDatabase().catch(() => undefined); process.exitCode = 1; });
