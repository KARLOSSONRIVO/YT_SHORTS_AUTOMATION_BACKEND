import { HydratedDocument, Schema, model } from 'mongoose';
import { STORY_FORMATS, type NicheProfile, type StoryFormat, type VoicePreference } from '../automation/automation.types';

export interface PersistentNicheProfile {
  profileId: string; name: string; slug: string; description: string; active: boolean;
  isFictional?: boolean;
  defaultLanguage: string; tone: string[]; targetAudience: string[]; topicCategories: string[];
  allowedNarrativeFormats: StoryFormat[]; voicePreferences: VoicePreference; visualPreferences: string[];
  researchRequirements: string[]; contentRestrictions: string[]; hashtagStrategy: string[]; targetRegion: string;
  createdAt?: Date; updatedAt?: Date;
}

const voicePreferenceSchema = new Schema<VoicePreference>({
  gender: { type: String, enum: ['female', 'male', 'neutral'] },
  energy: { type: Number, required: true }, speed: { type: Number, required: true },
  intensity: { type: Number, required: true }, traits: { type: [String], required: true }, accent: String
}, { _id: false });

const nicheProfileSchema = new Schema<PersistentNicheProfile>({
  profileId: { type: String, required: true, unique: true, index: true, trim: true },
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true, trim: true },
  description: { type: String, required: true, trim: true },
  active: { type: Boolean, required: true, default: true, index: true },
  isFictional: { type: Boolean, default: false },
  defaultLanguage: { type: String, required: true, default: 'en' },
  tone: { type: [String], required: true }, targetAudience: { type: [String], required: true },
  topicCategories: { type: [String], required: true },
  allowedNarrativeFormats: { type: [String], enum: STORY_FORMATS, required: true },
  voicePreferences: { type: voicePreferenceSchema, required: true },
  visualPreferences: { type: [String], required: true }, researchRequirements: { type: [String], required: true },
  contentRestrictions: { type: [String], required: true }, hashtagStrategy: { type: [String], required: true },
  targetRegion: { type: String, required: true }
}, { timestamps: true });

export type NicheProfileDocument = HydratedDocument<PersistentNicheProfile>;

export const toNicheProfile = (document: NicheProfileDocument): NicheProfile => ({
  id: document.profileId, name: document.name, slug: document.slug, description: document.description,
  active: document.active, isFictional: document.isFictional ?? false, tones: document.tone, defaultTone: document.tone[0], targetAudience: document.targetAudience,
  preferredVoice: document.voicePreferences, preferredVoiceCharacteristics: document.voicePreferences,
  voicePreferences: document.voicePreferences, visualStyle: document.visualPreferences.join(', '),
  visualPreferences: document.visualPreferences, contentRestrictions: document.contentRestrictions,
  preferredTopicCategories: document.topicCategories, topicCategories: document.topicCategories,
  preferredStoryFormats: document.allowedNarrativeFormats, allowedStoryFormats: document.allowedNarrativeFormats,
  hashtagCategories: document.hashtagStrategy, hashtagStrategy: document.hashtagStrategy,
  language: document.defaultLanguage, defaultLanguage: document.defaultLanguage,
  region: document.targetRegion, targetRegion: document.targetRegion, researchRequirements: document.researchRequirements,
  createdAt: document.createdAt, updatedAt: document.updatedAt
});

export const NicheProfileModel = model<PersistentNicheProfile>('NicheProfile', nicheProfileSchema);
