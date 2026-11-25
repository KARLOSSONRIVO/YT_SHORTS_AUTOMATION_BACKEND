import { DEFAULT_PROJECT_SUBTITLE_PREFERENCES, type CaptionPreset, type ProjectSubtitlePreferences } from "../../models/project.model";
import type { Clip } from "../../models/clip.model";

const basePreset = { ...DEFAULT_PROJECT_SUBTITLE_PREFERENCES, fontFamily: "Anton" };
const presets: Record<CaptionPreset, ProjectSubtitlePreferences> = {
  bold_stroke: { ...basePreset, preset: "bold_stroke" },
  red_highlight: { ...basePreset, preset: "red_highlight", fontSize: 88, highlightColor: "#E53935", position: "bottom_center", maxCharsPerLine: 22 },
  karaoke: { ...basePreset, preset: "karaoke", fontSize: 84, highlightColor: "#7C3AED", position: "bottom_center", maxCharsPerLine: 20 }
};

export function resolveSubtitlePreferences(
  stored?: Partial<ProjectSubtitlePreferences>, overrides?: Pick<Clip, "captionPreset" | "captionFontSize">
): ProjectSubtitlePreferences {
  const chosen = overrides?.captionPreset ? presets[overrides.captionPreset] : stored;
  const defaults = DEFAULT_PROJECT_SUBTITLE_PREFERENCES;
  const preferences = {
    preset: chosen?.preset,
    fontFamily: chosen?.fontFamily ?? defaults.fontFamily,
    fontSize: overrides?.captionFontSize ?? chosen?.fontSize ?? defaults.fontSize,
    fillColor: chosen?.fillColor ?? defaults.fillColor,
    strokeColor: chosen?.strokeColor ?? defaults.strokeColor,
    highlightColor: chosen?.highlightColor ?? defaults.highlightColor,
    position: chosen?.position ?? defaults.position,
    maxCharsPerLine: chosen?.maxCharsPerLine ?? defaults.maxCharsPerLine,
    maxLines: chosen?.maxLines ?? defaults.maxLines,
  };
  if (preferences.preset) return preferences;

  const highlight = preferences.highlightColor.toUpperCase();
  const preset = highlight === "#7C3AED" ? "karaoke"
    : highlight === "#E53935" ? "red_highlight"
      : highlight === preferences.fillColor.toUpperCase() ? "bold_stroke" : "custom";
  return {
    ...preferences,
    preset,
    fontFamily: preset !== "custom" && preferences.fontFamily === "DejaVu Sans" ? "Anton" : preferences.fontFamily
  };
}
