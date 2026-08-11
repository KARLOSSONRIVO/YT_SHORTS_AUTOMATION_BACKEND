import type { ContentHistoryDocument } from "../models/content-history.model";
export interface QcInput { content: ContentHistoryDocument; finalVideo?: { durationSeconds?: number; width?: number; height?: number; hasAudio?: boolean; blankSceneCount?: number; subtitleCount?: number; unauthorizedWatermark?: boolean; mediaRightsVerified?: boolean }; accountActive: boolean; }
export class QualityControlService {
  public check(input: QcInput) {
    const critical: string[] = []; const warnings: string[] = [];
    const c = input.content, v = input.finalVideo;
    if (!input.accountActive) warnings.push("assigned account credentials are inactive");
    if (!c.sourceLinks.length || c.sourceLinks.some((url) => !/^https?:\/\//.test(url))) warnings.push("important facts do not have valid source URLs");
    if (!c.script?.trim()) warnings.push("narration script is missing");
    if (!c.voiceId) warnings.push("voice selection is missing");
    if (!v) warnings.push("final video is missing");
    if (v && v.width && v.height && v.height <= v.width) warnings.push("video is not vertical");
    if (v?.hasAudio === false) warnings.push("video has no audio");
    if ((v?.blankSceneCount ?? 0) > 0) warnings.push("video contains blank scenes");
    if (v?.unauthorizedWatermark) warnings.push("video contains an unauthorized watermark");
    if (v && !v.mediaRightsVerified) warnings.push("media usage rights provenance is missing");
    if (v?.durationSeconds && Math.abs(v.durationSeconds - c.targetDurationSeconds) > 7) warnings.push("render duration is outside tolerance");
    if (!v?.subtitleCount) warnings.push("subtitle synchronization could not be independently verified");
    return { passed: critical.length === 0, critical, warnings, checkedAt: new Date().toISOString() };
  }
}
