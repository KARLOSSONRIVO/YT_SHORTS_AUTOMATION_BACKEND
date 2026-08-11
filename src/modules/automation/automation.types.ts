export const AUTOMATION_MODES = ["fully_automatic", "approval_before_upload", "draft_only"] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const CONTENT_TYPES = ['FACELESS_NICHE', 'REDDIT_STORY', 'CLIP_UPLOAD'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const VISUAL_TYPES = ['IMAGE', 'ANIMATED', 'AUTO'] as const;
export type VisualType = (typeof VISUAL_TYPES)[number];

export const STORY_FORMATS = [
  "shocking_fact", "mystery_reveal", "rise_and_fall", "rivalry",
  "record_breaking_moment", "hidden_history", "hero_story", "tragedy", "controversy",
  "unsolved_mystery", "myth_versus_fact", "what_really_happened",
  "one_decision_changed_everything", "unexpected_ending", "psychological_explanation"
] as const;
export type StoryFormat = (typeof STORY_FORMATS)[number];

export interface VoicePreference {
  gender?: "female" | "male" | "neutral";
  energy: number;
  speed: number;
  intensity: number;
  traits: string[];
  accent?: string;
}

export interface NicheProfile {
  id: string;
  name: string;
  slug: string;
  description: string;
  active: boolean;
  tones: string[];
  targetAudience: string[];
  preferredVoice: VoicePreference;
  visualStyle: string;
  contentRestrictions: string[];
  preferredTopicCategories: string[];
  preferredStoryFormats: StoryFormat[];
  hashtagCategories: string[];
  language: string;
  region: string;
  defaultTone: string;
  allowedStoryFormats: StoryFormat[];
  preferredVoiceCharacteristics: VoicePreference;
  topicCategories: string[];
  defaultLanguage: string;
  targetRegion: string;
  hashtagStrategy: string[];
  researchRequirements: string[];
  visualPreferences: string[];
  voicePreferences: VoicePreference;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface VoiceProfile {
  id: string;
  provider: string;
  languages: string[];
  gender: "female" | "male" | "neutral";
  traits: string[];
  energy: number;
  speed: number;
  intensity: number;
  accents: string[];
  costPerMillionCharactersUsd: number;
  dailyUsageLimit: number | null;
  priority: number;
  enabled: boolean;
  availability?: "available" | "unavailable";
  speakingRate?: number;
  usageLimits?: { dailyCharacters: number | null };
}

export interface TopicCandidate {
  embedding?: number[];
  topic: string;
  title: string;
  summary: string;
  storyAngle: string;
  importantEntities: string[];
  dates: string[];
  events: string[];
  keywords: string[];
  sourceLinks: string[];
  disputedFacts: string[];
  factualConfidence: number;
  scores: {
    curiosity: number;
    emotionalImpact: number;
    shortFormPotential: number;
    nicheRelevance: number;
    originality: number;
    retentionPotential: number;
  };
}

export interface DuplicateResult {
  duplicate: boolean;
  score: number;
  matchedHistoryId?: string;
  reasons: string[];
}
