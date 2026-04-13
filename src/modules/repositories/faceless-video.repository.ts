import type { FilterQuery } from "mongoose";
import {
  StoryAssetModel,
  type StoryAsset,
  type StoryAssetDocument,
  type StoryAssetType
} from "../models/story-asset.model";
import { StoryScriptModel, type StoryScript, type StoryScriptDocument } from "../models/story-script.model";
import { VideoRenderModel, type VideoRender, type VideoRenderDocument } from "../models/video-render.model";

export class FacelessVideoRepository {
  public upsertScript(projectId: string, payload: Omit<StoryScript, "projectId">): Promise<StoryScriptDocument> {
    return StoryScriptModel.findOneAndUpdate(
      { projectId },
      {
        $set: {
          ...payload,
          projectId: projectId as never
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).exec();
  }

  public findScript(projectId: string): Promise<StoryScriptDocument | null> {
    return StoryScriptModel.findOne({ projectId }).exec();
  }

  public async replaceAssets(
    projectId: string,
    assetTypes: StoryAssetType[],
    assets: Array<Omit<StoryAsset, "projectId">>
  ): Promise<StoryAssetDocument[]> {
    await StoryAssetModel.deleteMany({ projectId, assetType: { $in: assetTypes } }).exec();
    if (assets.length === 0) {
      return [];
    }

    return StoryAssetModel.insertMany(
      assets.map((asset) => ({
        ...asset,
        projectId: projectId as never
      }))
    );
  }

  public findAssets(projectId: string, filter: FilterQuery<StoryAsset> = {}): Promise<StoryAssetDocument[]> {
    return StoryAssetModel.find({ projectId, ...filter }).sort({ sceneIndex: 1, createdAt: 1 }).exec();
  }

  public findLatestAssetByType(projectId: string, assetType: StoryAssetType): Promise<StoryAssetDocument | null> {
    return StoryAssetModel.findOne({ projectId, assetType }).sort({ createdAt: -1 }).exec();
  }

  public upsertRender(projectId: string, payload: Partial<VideoRender>): Promise<VideoRenderDocument> {
    return VideoRenderModel.findOneAndUpdate(
      { projectId },
      {
        $set: {
          ...payload,
          projectId: projectId as never
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).exec();
  }

  public findRender(projectId: string): Promise<VideoRenderDocument | null> {
    return VideoRenderModel.findOne({ projectId }).exec();
  }
}
