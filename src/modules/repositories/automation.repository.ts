import { ContentHistoryModel, type ContentHistory, type ContentHistoryDocument } from "../models/content-history.model";
import { ProjectActivityModel, type ProjectActivity } from "../models/project-activity.model";
import { RejectedTopicModel, type RejectedTopic } from "../models/rejected-topic.model";
import { AutomationCheckpointModel } from "../models/automation-checkpoint.model";
import { TopicReservationModel, type TopicReservation, type TopicReservationDocument } from "../models/topic-reservation.model";
import type { TopicCandidate } from "../automation/automation.types";

export interface TopicReservationInput {
  projectId: string;
  accountId: string;
  nicheId: string;
  scheduledDate: string;
  role: "current" | "next";
  generationIdempotencyKey: string;
  topic: string;
  title: string;
  normalizedTopic: string;
  normalizedTitle: string;
}

export class AutomationRepository {
  findCheckpoint(projectId: string, scheduledDate: string) { return AutomationCheckpointModel.findOne({ projectId, scheduledDate }).lean().exec(); }
  saveResearchCheckpoint(projectId: string, scheduledDate: string, researchCandidates: TopicCandidate[]) {
    return AutomationCheckpointModel.findOneAndUpdate({ projectId, scheduledDate }, { $set: { researchCandidates } }, { upsert: true, new: true, setDefaultsOnInsert: true }).exec();
  }
  clearCheckpoint(projectId: string, scheduledDate: string) { return AutomationCheckpointModel.deleteOne({ projectId, scheduledDate }).exec(); }
  createHistory(input: ContentHistory) { return ContentHistoryModel.create(input); }
  async createHistoryIdempotent(input: ContentHistory): Promise<{ content: ContentHistoryDocument; created: boolean }> {
    let result: { value: ContentHistoryDocument | null; lastErrorObject?: { updatedExisting?: boolean } };
    try {
      result = await ContentHistoryModel.findOneAndUpdate(
        { generationIdempotencyKey: input.generationIdempotencyKey },
        { $setOnInsert: input },
        { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true, includeResultMetadata: true }
      ).exec() as unknown as typeof result;
    } catch (error) {
      const duplicateKey = typeof error === "object" && error !== null && "code" in error && error.code === 11000;
      if (!duplicateKey) throw error;
      const existing = await ContentHistoryModel.findOne({ generationIdempotencyKey: input.generationIdempotencyKey }).exec();
      if (!existing) throw error;
      return { content: existing, created: false };
    }
    if (!result.value) throw new Error("Content history upsert returned no document.");
    const updatedExisting = result.lastErrorObject?.updatedExisting;
    if (typeof updatedExisting !== "boolean") throw new Error("Content history upsert did not report whether it inserted a document.");
    return { content: result.value, created: !updatedExisting };
  }
  updateHistory(id: string, update: Partial<ContentHistory>) {
    const set: Partial<ContentHistory> = {};
    const unset: Record<string, ""> = {};
    for (const [key, value] of Object.entries(update)) {
      if (value === undefined) unset[key] = "";
      else (set as Record<string, unknown>)[key] = value;
    }
    const mongoUpdate: { $set?: Partial<ContentHistory>; $unset?: Record<string, ""> } = {};
    if (Object.keys(set).length) mongoUpdate.$set = set;
    if (Object.keys(unset).length) mongoUpdate.$unset = unset;
    return ContentHistoryModel.findByIdAndUpdate(id, mongoUpdate, { new: true }).exec();
  }
  findHistory(id: string) { return ContentHistoryModel.findById(id).exec(); }
  findByGenerationKey(key: string) { return ContentHistoryModel.findOne({ generationIdempotencyKey: key }).exec(); }
  findHistoryForProject(projectId: string, limit = 100) { return ContentHistoryModel.find({ projectId }).sort({ createdAt: -1 }).limit(limit).exec(); }
  findTodayForProject(projectId: string, start: Date, end: Date) { return ContentHistoryModel.find({ projectId, createdAt: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).exec(); }
  findComparisonHistory(nicheId: string, accountId: string, limit = 500) { return ContentHistoryModel.find({ nicheId, accountId, status: { $ne: "rejected" } }).sort({ createdAt: -1 }).limit(limit).exec(); }
  findTopicReservations(accountId: string, nicheId: string, limit = 500) {
    return TopicReservationModel.find({ accountId, nicheId }).sort({ createdAt: -1 }).limit(limit).lean().exec();
  }
  async reserveTopic(input: TopicReservationInput): Promise<TopicReservationDocument | null> {
    try {
      return await TopicReservationModel.create(input as unknown as TopicReservation);
    } catch (error) {
      const duplicateKey = typeof error === "object" && error !== null && "code" in error && error.code === 11000;
      if (!duplicateKey) throw error;
      const existing = await TopicReservationModel.findOne({
        accountId: input.accountId,
        nicheId: input.nicheId,
        $or: [{ normalizedTopic: input.normalizedTopic }, { normalizedTitle: input.normalizedTitle }]
      }).exec();
      return existing?.generationIdempotencyKey === input.generationIdempotencyKey ? existing : null;
    }
  }
  releaseTopicReservations(generationIdempotencyKey: string) {
    return TopicReservationModel.deleteMany({ generationIdempotencyKey }).exec();
  }
  findPendingFinalization(limit = 50) { return ContentHistoryModel.find({ status: { $in: ["queued", "researching", "writing", "generating_voice", "generating_visuals", "rendering", "quality_check", "scheduled"] }, renderProjectId: { $exists: true }, $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: new Date() } }] }).sort({ createdAt: 1 }).limit(limit).exec(); }
  countUploadedSince(accountId: string, since: Date) { return ContentHistoryModel.countDocuments({ accountId, status: "uploaded", uploadDate: { $gte: since } }).exec(); }
  claimUpload(id: string) { return ContentHistoryModel.findOneAndUpdate({ _id: id, status: { $in: ["scheduled", "awaiting_approval"] }, platformVideoId: { $exists: false } }, { $set: { status: "uploading" }, $inc: { uploadAttempts: 1 } }, { new: true }).exec(); }
  createRejected(input: RejectedTopic) { return RejectedTopicModel.create(input); }
  findRejected(projectId: string, limit = 100) { return RejectedTopicModel.find({ projectId }).sort({ createdAt: -1 }).limit(limit).exec(); }
  logActivity(input: ProjectActivity) { return ProjectActivityModel.create(input); }
  findActivity(projectId: string, limit = 100) { return ProjectActivityModel.find({ projectId }).sort({ createdAt: -1 }).limit(limit).exec(); }
  deleteProjectData(projectId: string) { return Promise.all([
    ContentHistoryModel.deleteMany({ projectId }).exec(),
    RejectedTopicModel.deleteMany({ projectId }).exec(),
    ProjectActivityModel.deleteMany({ projectId }).exec(),
    TopicReservationModel.deleteMany({ projectId }).exec()
  ]); }
}
