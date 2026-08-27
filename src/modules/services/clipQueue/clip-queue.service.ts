import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import type { MediaInspectionService } from '../../automation/media-inspection.service';
import { QueuedClipModel } from '../../models/queued-clip.model';
import type { ChannelRepository } from '../../repositories/channel.repository';
import type { UploadHistoryRepository } from '../../repositories/upload-history.repository';
import type { AutomationRepository } from '../../repositories/automation.repository';
import type { ProjectService } from '../project/project.service';
import type { StorageService } from '../storage/storage.service';
import type { YouTubeService } from '../youtube/youtube.service';
import { sanitizeUploadTitle, normalizeHashtags } from '../publish/upload-text';

export interface AddQueuedClipInput {
  userId: string; projectId: string; file: Express.Multer.File; thumbnail?: Express.Multer.File; subtitles?: Express.Multer.File;
  title: string; description?: string; hashtags?: string; language: string; scheduledAt?: Date;
  privacyStatus: 'private' | 'public' | 'unlisted'; audienceSetting: 'not_made_for_kids' | 'made_for_kids';
}
export const clipUploadIdempotencyKey = (clipId: string, accountId: string) => clipId + ':' + accountId + ':CLIP_UPLOAD';
export const isSupportedClipMime = (mimeType: string) => ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'].includes(mimeType);
export const validateClipMedia = (media: { durationSeconds: number; width?: number; height?: number; hasAudio: boolean }) =>
  Boolean(media.durationSeconds > 0 && media.durationSeconds <= 43_200 && (media.width ?? 0) >= 240 && (media.height ?? 0) >= 240 && media.hasAudio);

export class ClipQueueService {
  constructor(private readonly projects: ProjectService, private readonly storage: StorageService,
    private readonly inspection: MediaInspectionService, private readonly channels: ChannelRepository,
    private readonly youtube: YouTubeService, private readonly uploads: UploadHistoryRepository,
    private readonly activity?: AutomationRepository) {}

  public async add(input: AddQueuedClipInput) {
    const project = await this.projects.getOwnedProjectOrThrow(input.projectId, input.userId);
    if (project.contentType !== 'CLIP_UPLOAD' || !project.accountId)
      throw new AppError('Project is not a Clip Upload project.', 409, 'INVALID_PROJECT_TYPE');
    this.validateFile(input.file);
    const [hash, media] = await Promise.all([this.fileHash(input.file.path), this.inspection.inspect(input.file.path)]);
    if (!validateClipMedia(media)) throw new AppError('Video must be readable, within platform limits, and contain audio.', 422, 'INVALID_VIDEO_MEDIA');
    if (await QueuedClipModel.exists({ sourceFileHash: hash, accountId: project.accountId }))
      throw new AppError('This clip was already queued for the selected account.', 409, 'DUPLICATE_CLIP');
    if (input.thumbnail && !['image/jpeg', 'image/png', 'image/webp'].includes(input.thumbnail.mimetype))
      throw new AppError('Thumbnail must be JPEG, PNG, or WebP.', 422, 'INVALID_THUMBNAIL');
    if (input.subtitles && !['application/x-subrip', 'text/srt', 'text/vtt'].includes(input.subtitles.mimetype))
      throw new AppError('Subtitles must be SRT or VTT.', 422, 'INVALID_SUBTITLES');
    const [stored, storedThumbnail, storedSubtitles] = await Promise.all([
      this.storage.storeSourceVideo(input.file), input.thumbnail ? this.storage.storeSourceVideo(input.thumbnail) : Promise.resolve(undefined),
      input.subtitles ? this.storage.storeSourceVideo(input.subtitles) : Promise.resolve(undefined)
    ]);
    const clipId = new Types.ObjectId();
    const queuePosition = await QueuedClipModel.countDocuments({ projectId: project._id, status: { $ne: 'uploaded' } });
    const created = await QueuedClipModel.create({
      _id: clipId, projectId: project._id, accountId: project.accountId, sourceFile: stored.storageKey, sourceFileHash: hash,
      thumbnailFile: storedThumbnail?.storageKey,
      subtitleFile: storedSubtitles?.storageKey,
      title: input.title, description: input.description, hashtags: this.hashtags(input.hashtags), language: input.language,
      scheduledAt: input.scheduledAt,
      status: project.automationMode === 'draft_only' ? 'draft' :
        project.automationMode === 'approval_before_upload' ? 'pending' : input.scheduledAt ? 'scheduled' : 'pending',
      privacyStatus: input.privacyStatus, audienceSetting: input.audienceSetting, queuePosition,
      durationSeconds: media.durationSeconds, width: media.width, height: media.height, hasAudio: media.hasAudio,
      uploadIdempotencyKey: clipUploadIdempotencyKey(String(clipId), String(project.accountId))
    });
    await this.activity?.logActivity({ projectId: project._id, userId: project.userId, type: 'clip_queued', severity: 'info',
      message: 'Queued clip: ' + created.title, metadata: { clipId: created.id, scheduledAt: created.scheduledAt } });
    return created;
  }

  public async list(userId: string, projectId: string) {
    await this.projects.getOwnedProjectOrThrow(projectId, userId);
    return QueuedClipModel.find({ projectId }).sort({ queuePosition: 1, createdAt: 1 }).exec();
  }
  public async replace(userId: string, projectId: string, clipId: string, file: Express.Multer.File) {
    await this.projects.getOwnedProjectOrThrow(projectId, userId); this.validateFile(file);
    const clip = await QueuedClipModel.findOne({ _id: clipId, projectId, status: { $in: ['pending', 'scheduled', 'failed', 'draft'] } }).exec();
    if (!clip) throw new AppError('Only pending clips can be replaced.', 409, 'CLIP_REPLACE_INVALID');
    const [hash, media] = await Promise.all([this.fileHash(file.path), this.inspection.inspect(file.path)]);
    if (!validateClipMedia(media)) throw new AppError('Replacement video is invalid.', 422, 'INVALID_VIDEO_MEDIA');
    if (await QueuedClipModel.exists({ _id: { $ne: clip._id }, sourceFileHash: hash, accountId: clip.accountId }))
      throw new AppError('This clip was already queued for the selected account.', 409, 'DUPLICATE_CLIP');
    const stored = await this.storage.storeSourceVideo(file); const previous = clip.sourceFile;
    const updated = await QueuedClipModel.findByIdAndUpdate(clip.id, {
      sourceFile: stored.storageKey, sourceFileHash: hash, durationSeconds: media.durationSeconds,
      width: media.width, height: media.height, hasAudio: media.hasAudio, status: 'pending', error: undefined
    }, { new: true }).exec();
    await this.storage.delete(previous).catch(() => undefined);
    return updated;
  }
  public async history(userId: string, projectId: string) {
    await this.projects.getOwnedProjectOrThrow(projectId, userId);
    return QueuedClipModel.find({ projectId, status: 'uploaded' }).sort({ uploadedAt: -1 }).exec();
  }
  public async reorder(userId: string, projectId: string, clipIds: string[]) {
    await this.projects.getOwnedProjectOrThrow(projectId, userId);
    const clips = await QueuedClipModel.find({ projectId, _id: { $in: clipIds }, status: { $in: ['pending', 'scheduled', 'failed', 'draft'] } }).exec();
    if (clips.length !== clipIds.length) throw new AppError('One or more clips cannot be reordered.', 409, 'CLIP_REORDER_INVALID');
    await QueuedClipModel.bulkWrite(clipIds.map((id, queuePosition) => ({ updateOne: { filter: { _id: id, projectId }, update: { queuePosition } } })));
    return this.list(userId, projectId);
  }
  public async schedule(userId: string, projectId: string, clipId: string, scheduledAt: Date) {
    await this.projects.getOwnedProjectOrThrow(projectId, userId);
    return this.updatePending(projectId, clipId, { scheduledAt, status: 'scheduled', error: undefined });
  }
  public async remove(userId: string, projectId: string, clipId: string) {
    await this.projects.getOwnedProjectOrThrow(projectId, userId);
    const clip = await QueuedClipModel.findOneAndDelete({ _id: clipId, projectId, status: { $in: ['pending', 'scheduled', 'failed', 'draft'] } }).exec();
    if (!clip) throw new AppError('Only pending clips can be removed.', 409, 'CLIP_REMOVE_INVALID');
    await this.storage.delete(clip.sourceFile).catch(() => undefined);
    return { deleted: true };
  }
  public async retry(userId: string, projectId: string, clipId: string) {
    await this.projects.getOwnedProjectOrThrow(projectId, userId);
    const clip = await this.updatePending(projectId, clipId, { status: 'scheduled', scheduledAt: new Date(), error: undefined }, ['failed']);
    return this.upload(clip.id);
  }
  public async uploadNow(userId: string, projectId: string, clipId: string) {
    await this.projects.getOwnedProjectOrThrow(projectId, userId);
    const clip = await QueuedClipModel.findOne({ _id: clipId, projectId }).exec();
    if (!clip) throw new AppError('Clip was not found.', 404, 'CLIP_NOT_FOUND');
    return this.upload(clip.id);
  }
  public async uploadNextDue(projectId: string) {
    const clip = await QueuedClipModel.findOne({ projectId, status: 'scheduled', scheduledAt: { $lte: new Date() } }).sort({ queuePosition: 1 }).exec();
    return clip ? this.upload(clip.id) : { skipped: true };
  }

  public async upload(clipId: string) {
    const clip = await QueuedClipModel.findOneAndUpdate(
      { _id: clipId, status: { $in: ['pending', 'scheduled', 'failed'] }, platformVideoId: { $exists: false } },
      { $set: { status: 'uploading', error: undefined } }, { new: true }
    ).exec();
    if (!clip) {
      const existing = await QueuedClipModel.findById(clipId).exec();
      if (existing?.status === 'uploaded') return existing;
      throw new AppError('Clip upload is already claimed or unavailable.', 409, 'DUPLICATE_CLIP_UPLOAD_BLOCKED');
    }
    const channel = await this.channels.findById(String(clip.accountId));
    if (!channel || channel.status !== 'connected') throw new AppError('YouTube account is unavailable.', 409, 'ACCOUNT_CREDENTIALS_INACTIVE');
    try {
      const title = sanitizeUploadTitle(clip.title);
      const description = [clip.description, normalizeHashtags(clip.hashtags, { ensureShorts: true }).map((tag) => '#' + tag).join(' ')].filter(Boolean).join('\n\n');
      const result = await this.youtube.uploadShort({
        tokens: { access_token: channel.accessToken, refresh_token: channel.refreshToken, expiry_date: channel.tokenExpiryDate?.getTime() },
        title, description, privacyStatus: clip.privacyStatus, videoPath: this.storage.resolveStoragePath(clip.sourceFile)
        ,madeForKids: clip.audienceSetting === 'made_for_kids',
        thumbnailPath: clip.thumbnailFile ? this.storage.resolveStoragePath(clip.thumbnailFile) : undefined,
        subtitlePath: clip.subtitleFile ? this.storage.resolveStoragePath(clip.subtitleFile) : undefined,
        subtitleLanguage: clip.language
      });
      const updated = await QueuedClipModel.findByIdAndUpdate(clip.id, {
        status: 'uploaded', platformVideoId: result.id, uploadedAt: new Date(), error: undefined
      }, { new: true }).exec();
      await this.uploads.create({
        projectId: clip.projectId, channelId: clip.accountId, youtubeVideoId: result.id ?? undefined,
        idempotencyKey: clip.uploadIdempotencyKey,
        title, description, privacyStatus: clip.privacyStatus, status: 'uploaded', uploadedAt: new Date(),
        responseSnapshot: { ...result, queuedClipId: clip.id, uploadIdempotencyKey: clip.uploadIdempotencyKey }
      });
      await this.projects.updateProject(String(clip.projectId), { lastUploadAt: new Date() });
      const project = await this.projects.getProjectOrThrow(String(clip.projectId));
      await this.activity?.logActivity({ projectId: project._id, userId: project.userId, type: 'clip_uploaded', severity: 'info',
        message: 'Uploaded clip: ' + clip.title, metadata: { clipId: clip.id, platformVideoId: result.id } });
      return updated;
    } catch (error) {
      await QueuedClipModel.findByIdAndUpdate(clip.id, { status: 'failed', error: error instanceof Error ? error.message : 'Upload failed.' }).exec();
      throw error;
    }
  }

  private async updatePending(projectId: string, clipId: string, update: Record<string, unknown>, statuses = ['pending', 'scheduled', 'failed', 'draft']) {
    const clip = await QueuedClipModel.findOneAndUpdate({ _id: clipId, projectId, status: { $in: statuses } }, update, { new: true }).exec();
    if (!clip) throw new AppError('Clip was not found or cannot be changed.', 409, 'CLIP_UPDATE_INVALID');
    return clip;
  }
  private validateFile(file: Express.Multer.File) {
    if (!isSupportedClipMime(file.mimetype) || file.size <= 0) throw new AppError('Use a valid MP4, MOV, WebM, or MKV video.', 422, 'INVALID_VIDEO_FILE');
  }
  private async fileHash(path: string) { return crypto.createHash('sha256').update(await fs.readFile(path)).digest('hex'); }
  private hashtags(value?: string) { return (value ?? '').split(/[\s,]+/).map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean).slice(0, 30); }
}
