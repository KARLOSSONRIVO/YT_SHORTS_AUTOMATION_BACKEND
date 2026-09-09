import type { FilterQuery, UpdateQuery } from "mongoose";
import { ProjectModel, type Project, type ProjectDocument } from "../models/project.model";
import type { SerializedStoryAssignment } from "../automation/automation.types";
import { buildNextSerializedStoryState, ORIGINAL_SERIALIZED_MYSTERY_NICHE_ID } from "../automation/serialized-story";

export class ProjectRepository {
  public create(payload: Partial<Project>): Promise<ProjectDocument> {
    return ProjectModel.create(payload);
  }

  public findById(projectId: string): Promise<ProjectDocument | null> {
    return ProjectModel.findById(projectId).exec();
  }

  public findMany(filter: FilterQuery<Project> = {}): Promise<ProjectDocument[]> {
    return ProjectModel.find({ internalStory: { $ne: true }, ...filter }).sort({ createdAt: -1 }).exec();
  }

  public findOwnedById(projectId: string, userId: string): Promise<ProjectDocument | null> {
    return ProjectModel.findOne({ _id: projectId, userId, internalStory: { $ne: true } }).exec();
  }

  public findDue(now: Date, limit = 25): Promise<ProjectDocument[]> {
    return ProjectModel.find({ contentType: { $in: ["FACELESS_NICHE", "REDDIT_STORY", "CLIP_UPLOAD"] },
      internalStory: { $ne: true }, automationEnabled: true, nextRunAt: { $lte: now } })
      .sort({ nextRunAt: 1 }).limit(limit).exec();
  }

  public claimDue(projectId: string, expectedNextRunAt: Date, nextRunAt: Date): Promise<ProjectDocument | null> {
    return ProjectModel.findOneAndUpdate(
      { _id: projectId, automationEnabled: true, nextRunAt: expectedNextRunAt },
      { $set: { nextRunAt, lastRunAt: new Date(), automationStatus: "running" } },
      { new: true }
    ).exec();
  }

  public findInternalStories(parentProjectId: string): Promise<ProjectDocument[]> {
    return ProjectModel.find({ parentProjectId, internalStory: true }).sort({ createdAt: -1 }).exec();
  }

  public updateById(projectId: string, update: UpdateQuery<Project>): Promise<ProjectDocument | null> {
    return ProjectModel.findByIdAndUpdate(projectId, update, { new: true }).exec();
  }

  public advanceSerializedStory(parentProjectId: string, assignment: SerializedStoryAssignment): Promise<ProjectDocument | null> {
    const nextState = buildNextSerializedStoryState(assignment);
    const isFinalEpisode = assignment.episodeNumber >= assignment.episodesPerSeries;
    const update: UpdateQuery<Project> = isFinalEpisode
      ? {
        $set: { "serializedStory.episodesPerSeries": nextState.episodesPerSeries, "serializedStory.nextSeriesNumber": nextState.nextSeriesNumber, "serializedStory.nextEpisodeNumber": nextState.nextEpisodeNumber },
        $unset: { "serializedStory.seriesTitle": 1, "serializedStory.premise": 1, "serializedStory.setting": 1, "serializedStory.characterNotes": 1, "serializedStory.lastEpisodeSummary": 1, "serializedStory.queuedEpisodeTitle": 1, "serializedStory.queuedEpisodeTopic": 1, "serializedStory.queuedEpisodePromise": 1 }
      }
      : { $set: { serializedStory: nextState } };

    return ProjectModel.findOneAndUpdate(
      {
        _id: parentProjectId,
        nicheId: ORIGINAL_SERIALIZED_MYSTERY_NICHE_ID,
        "serializedStory.nextSeriesNumber": assignment.seriesNumber,
        "serializedStory.nextEpisodeNumber": assignment.episodeNumber
      },
      update,
      { new: true }
    ).exec();
  }

  public deleteById(projectId: string): Promise<ProjectDocument | null> {
    return ProjectModel.findByIdAndDelete(projectId).exec();
  }
}
