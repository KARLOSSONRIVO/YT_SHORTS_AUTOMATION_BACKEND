import { AppError } from "../../common/errors/app-error";
import type { NicheProfile, StoryFormat, VoiceProfile } from "./automation.types";

export class VoiceSelector {
  public select(profile: NicheProfile, voices: VoiceProfile[], format: StoryFormat, language: string, gender?: string): { selected: VoiceProfile; fallback: VoiceProfile | null } {
    const available = voices.filter((voice) => voice.enabled && voice.languages.includes(language) && (!gender || voice.gender === gender));
    if (!available.length) throw new AppError("No voice supports the configured language and preference.", 409, "VOICE_UNAVAILABLE");
    const desiredTraits = new Set([...profile.preferredVoice.traits, ...(format.includes("mystery") ? ["suspenseful", "controlled"] : [])]);
    const ranked = available.map((voice) => ({ voice, score:
      voice.traits.filter((trait) => desiredTraits.has(trait)).length * 2 +
      (1 - Math.abs(voice.energy - profile.preferredVoice.energy)) +
      (1 - Math.min(Math.abs(voice.speed - profile.preferredVoice.speed), 1)) +
      (1 - Math.abs(voice.intensity - profile.preferredVoice.intensity)) + voice.priority / 100
    })).sort((a, b) => b.score - a.score);
    return { selected: ranked[0].voice, fallback: ranked[1]?.voice ?? null };
  }
}
