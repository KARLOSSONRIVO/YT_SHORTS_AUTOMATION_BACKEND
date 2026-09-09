import type { NicheProfile, StoryFormat, TopicCandidate } from "./automation.types";
import { ORIGINAL_SERIALIZED_MYSTERY_NICHE_ID } from "./serialized-story";

const SIGNALS: Partial<Record<StoryFormat, string[]>> = {
  record_breaking_moment: ["record", "fastest", "highest", "first", "most"], controversy: ["controversy", "banned", "scandal", "disputed"],
  mystery_reveal: ["mystery", "hidden", "discovered", "evidence"], unsolved_mystery: ["unsolved", "missing", "unknown", "unexplained"],
  hidden_history: ["hidden", "forgotten", "oldest", "ancient", "lost", "before", "precolonial", "inscription", "artifact"],
  what_really_happened: ["what really", "truth", "evidence", "actually", "history remembers"],
  myth_versus_fact: ["myth", "legend", "oral tradition", "actually", "not just", "misconception", "believed"],
  rise_and_fall: ["rise", "fall", "empire", "collapse", "career"], hero_story: ["hero", "heroine", "revolution", "resisted", "defied", "fought", "courage"],
  tragedy: ["tragedy", "died", "disaster", "loss"],
  psychological_explanation: ["psychology", "brain", "behavior", "bias", "habit"],
  one_decision_changed_everything: ["decision", "choice", "order", "refused"], rivalry: ["rival", "versus", "competition", "feud"]
};

export class StoryFormatSelector {
  public select(profile: NicheProfile, candidate: TopicCandidate, settings?: { mode?: "auto_select" | "manual_select" | "selected_formats"; manual?: StoryFormat; allowed?: StoryFormat[] }): StoryFormat {
    if (settings?.mode === "manual_select" && settings.manual && profile.preferredStoryFormats.includes(settings.manual)) return settings.manual;
    const approved = settings?.mode === "selected_formats" && settings.allowed?.length
      ? profile.preferredStoryFormats.filter((format) => settings.allowed?.includes(format))
      : profile.preferredStoryFormats;
    const text = `${candidate.topic} ${candidate.summary} ${candidate.storyAngle} ${candidate.keywords.join(" ")}`.toLowerCase();
    return approved
      .map((format, index) => ({ format, score: (SIGNALS[format] ?? []).filter((signal) => text.includes(signal)).length * 3 + (profile.preferredStoryFormats.length - index) * 0.1 }))
      .sort((a, b) => b.score - a.score)[0]?.format ?? profile.preferredStoryFormats[0];
  }

  public framework(format: StoryFormat, nicheId?: string): "psychology_truth" | "history_story" | "serialized_story" {
    if (nicheId === ORIGINAL_SERIALIZED_MYSTERY_NICHE_ID) return "serialized_story";
    return nicheId === "psychology" || format === "psychological_explanation" ? "psychology_truth" : "history_story";
  }
}
