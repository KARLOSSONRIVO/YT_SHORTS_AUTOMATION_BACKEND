import { ContentHistoryModel, type ContentHistory } from "../models/content-history.model";
import { ProjectActivityModel, type ProjectActivity } from "../models/project-activity.model";
import { RejectedTopicModel, type RejectedTopic } from "../models/rejected-topic.model";
import { AutomationCheckpointModel } from "../models/automation-checkpoint.model";
import type { TopicCandidate } from "../automation/automation.types";

export class AutomationRepository {
  findCheckpoint(projectId: string, scheduledDate: string) { return AutomationCheckpointModel.findOne({ projectId, scheduledDate }).lean().exec(); }
  saveResearchCheckpoint(projectId: string, scheduledDate: string, researchCandidates: TopicCandidate[]) {
    return AutomationCheckpointModel.findOneAndUpdate({ projectId, scheduledDate }, { $set: { researchCandidates } }, { upsert: true, new: true, setDefaultsOnInsert: true }).exec();
  }
  clearCheckpoint(projectId: string, scheduledDate: string) { return AutomationCheckpointModel.deleteOne({ projectId, scheduledDate }).exec(); }
  createHistory(input: ContentHistory) { return ContentHistoryModel.create(input); }
  updateHistory(id: string, update: Partial<ContentHistory>) { return ContentHistoryModel.findByIdAndUpdate(id, update, { new: true }).exec(); }
  findHistory(id: string) { return ContentHistoryModel.findById(id).exec(); }
  findByGenerationKey(key: string) { return ContentHistoryModel.findOne({ generationIdempotencyKey: key }).exec(); }
  findHistoryForProject(projectId: string, limit = 100) { return ContentHistoryModel.find({ projectId }).sort({ createdAt: -1 }).limit(limit).exec(); }
  findTodayForProject(projectId: string, start: Date, end: Date) { return ContentHistoryModel.find({ projectId, createdAt: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).exec(); }
  findComparisonHistory(nicheId: string, accountId: string, limit = 500) { return ContentHistoryModel.find({ nicheId, accountId, status: { $ne: "rejected" } }).sort({ createdAt: -1 }).limit(limit).exec(); }
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
    ProjectActivityModel.deleteMany({ projectId }).exec()
  ]); }
}
