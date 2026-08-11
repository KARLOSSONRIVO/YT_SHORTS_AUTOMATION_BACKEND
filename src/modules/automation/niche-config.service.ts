import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import { STORY_FORMATS, type NicheProfile, type VoiceProfile } from "./automation.types";
import { NicheProfileModel, toNicheProfile, type PersistentNicheProfile } from "../models/niche-profile.model";

const voicePreferenceSchema = z.object({
  gender: z.enum(["female", "male", "neutral"]).optional(),
  energy: z.number().min(0).max(1), speed: z.number().min(0.5).max(2), intensity: z.number().min(0).max(1),
  traits: z.array(z.string().min(1)).min(1), accent: z.string().optional()
});
const nicheSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/), name: z.string().min(1), tones: z.array(z.string()).min(1),
  targetAudience: z.array(z.string()).min(1), preferredVoice: voicePreferenceSchema, visualStyle: z.string().min(1),
  contentRestrictions: z.array(z.string()), preferredTopicCategories: z.array(z.string()).min(1),
  preferredStoryFormats: z.array(z.enum(STORY_FORMATS)).min(1), hashtagCategories: z.array(z.string()).min(1),
  language: z.string().min(2), region: z.string().min(2)
});
const defaultsSchema = z.object({
  targetDurationSeconds: z.number().int().min(15).max(180), language: z.string(), region: z.string(), timezone: z.string(),
  uploadTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), dailyUploadLimit: z.number().int().positive(),
  automationMode: z.enum(["fully_automatic", "approval_before_upload", "draft_only"]),
  similarityThreshold: z.number().min(0).max(1)
});
const nicheRegistrySchema = z.object({ version: z.number(), defaults: defaultsSchema, niches: z.array(nicheSchema).min(1) });
const voiceSchema = z.object({
  id: z.string(), provider: z.string(), languages: z.array(z.string()).min(1), gender: z.enum(["female", "male", "neutral"]),
  traits: z.array(z.string()), energy: z.number().min(0).max(1), speed: z.number().min(0.5).max(2),
  intensity: z.number().min(0).max(1), accents: z.array(z.string()), costPerMillionCharactersUsd: z.number().nonnegative(),
  dailyUsageLimit: z.number().positive().nullable(), priority: z.number(), enabled: z.boolean()
});

export class NicheConfigService {
  private readonly nicheRegistry;
  private readonly voiceRegistry: VoiceProfile[];

  constructor(configRoot = path.resolve(process.cwd(), "config")) {
    this.nicheRegistry = nicheRegistrySchema.parse(JSON.parse(fs.readFileSync(path.join(configRoot, "niches.json"), "utf8")));
    this.voiceRegistry = z.object({ version: z.number(), voices: z.array(voiceSchema) })
      .parse(JSON.parse(fs.readFileSync(path.join(configRoot, "voices.json"), "utf8"))).voices as VoiceProfile[];
  }

  public listNiches(): NicheProfile[] {
    return this.nicheRegistry.niches.map((niche) => ({
      ...niche,
      slug: niche.id.replaceAll("_", "-"),
      description: niche.name + " stories tailored for short-form factual storytelling.",
      active: true,
      defaultTone: niche.tones[0],
      allowedStoryFormats: niche.preferredStoryFormats,
      preferredVoiceCharacteristics: niche.preferredVoice,
      topicCategories: niche.preferredTopicCategories,
      defaultLanguage: niche.language,
      targetRegion: niche.region,
      hashtagStrategy: niche.hashtagCategories,
      researchRequirements: niche.contentRestrictions,
      visualPreferences: [niche.visualStyle],
      voicePreferences: niche.preferredVoice
    })) as NicheProfile[];
  }
  public async seedDefaults() {
    const profiles = this.listNiches();
    await NicheProfileModel.bulkWrite(profiles.map((profile) => ({
      updateOne: { filter: { profileId: profile.id }, update: { $setOnInsert: this.persistentPayload(profile) }, upsert: true }
    })));
    return { seeded: profiles.length, total: await NicheProfileModel.countDocuments() };
  }
  public async ensureSeeded() {
    if (await NicheProfileModel.countDocuments() === 0) await this.seedDefaults();
  }
  public async listActiveNiches() {
    if (NicheProfileModel.db.readyState === 0) return this.listNiches().filter((profile) => profile.active);
    await this.ensureSeeded();
    return (await NicheProfileModel.find({ active: true }).sort({ name: 1 }).exec()).map(toNicheProfile);
  }
  public async getPersistentNicheOrThrow(profileId: string) {
    if (NicheProfileModel.db.readyState === 0) return this.getNicheOrThrow(profileId);
    await this.ensureSeeded();
    const profile = await NicheProfileModel.findOne({ profileId }).exec();
    if (!profile) throw new AppError("Unsupported niche.", 404, "NICHE_NOT_FOUND", { nicheId: profileId });
    return toNicheProfile(profile);
  }
  public async createNiche(input: PersistentNicheProfile) {
    return toNicheProfile(await NicheProfileModel.create(input));
  }
  public async updateNiche(profileId: string, input: Partial<PersistentNicheProfile>) {
    const profile = await NicheProfileModel.findOneAndUpdate({ profileId }, input, { new: true, runValidators: true }).exec();
    if (!profile) throw new AppError("Niche profile was not found.", 404, "NICHE_NOT_FOUND");
    return toNicheProfile(profile);
  }
  public setNicheActive(profileId: string, active: boolean) { return this.updateNiche(profileId, { active }); }
  public getDefaults() { return this.nicheRegistry.defaults; }
  public listVoices() {
    return this.voiceRegistry.filter((voice) => voice.enabled).map((voice) => ({
      ...voice,
      availability: "available" as const,
      speakingRate: voice.speed,
      usageLimits: { dailyCharacters: voice.dailyUsageLimit }
    }));
  }
  public getNicheOrThrow(nicheId: string): NicheProfile {
    const niche = this.listNiches().find((item) => item.id === nicheId);
    if (!niche) throw new AppError("Unsupported niche.", 404, "NICHE_NOT_FOUND", { nicheId });
    return niche;
  }

  private persistentPayload(profile: NicheProfile): PersistentNicheProfile {
    return {
      profileId: profile.id, name: profile.name, slug: profile.slug, description: profile.description, active: profile.active,
      defaultLanguage: profile.defaultLanguage, tone: profile.tones, targetAudience: profile.targetAudience,
      topicCategories: profile.topicCategories, allowedNarrativeFormats: profile.allowedStoryFormats,
      voicePreferences: profile.voicePreferences, visualPreferences: profile.visualPreferences,
      researchRequirements: profile.researchRequirements, contentRestrictions: profile.contentRestrictions,
      hashtagStrategy: profile.hashtagStrategy, targetRegion: profile.targetRegion
    };
  }
}
