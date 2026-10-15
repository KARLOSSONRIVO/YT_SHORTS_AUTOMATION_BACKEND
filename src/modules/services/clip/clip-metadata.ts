import { normalizeHashtags, sanitizeUploadTitle } from "../publish/upload-text";

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "being", "could", "does", "doing", "from", "have", "into",
  "just", "like", "more", "most", "much", "only", "over", "really", "some", "than", "that", "their",
  "them", "then", "there", "they", "this", "very", "what", "when", "where", "which", "while", "with",
  "would", "your", "you", "its", "it's", "we", "we're", "were", "we'll", "i", "i'm", "i'll", "you'll",
  "that's", "can", "could", "did", "get", "going", "know", "like", "okay", "want", "will", "ahead",
  "almost", "bitch", "damn", "doesn't", "doesnt", "don't", "dont", "fucking", "good", "grab", "guys",
  "isn't", "isnt", "open", "right", "shit", "sorry", "take", "wait", "wasn't", "wasnt", "yeah", "anything",
  "attention", "automatically", "been", "done", "fine"
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .match(/[a-zA-Z0-9]+(?:'[a-zA-Z0-9]+)?/g)
    ?.map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)) ?? [];

const isIncompleteSentence = (text: string): boolean => {
  const normalized = text.replace(/[.!?]+$/, "").trim();
  return /\.{2,}\s*$/.test(text) ||
    /\b(?:and|or|but|because|if|when|while|to|with|for|from|of|in|on|at|as|than|that|which|who|where|you're|we're|i'm|it's|is|are|was|were|can|could|will|would|should|be)$/i.test(normalized);
};

const bestSentence = (text: string): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => ({
      text: sentence.replace(/[.!?]+$/, "").trim(),
      hasHookPunctuation: /[!?]\s*$/.test(sentence),
      incomplete: isIncompleteSentence(sentence)
    }))
    .map(({ text, hasHookPunctuation, incomplete }) => ({ text, hasHookPunctuation, incomplete }))
    .filter(Boolean);
  const ranked = sentences
    .map(({ text, hasHookPunctuation, incomplete }, index) => ({
      sentence: text,
      index,
      wordCount: text.split(/\s+/).length,
      contentCount: tokenize(text).length,
      hookBonus: hasHookPunctuation ? 2 : 0,
      incomplete
    }))
    .filter((candidate) => !candidate.incomplete && candidate.wordCount >= 3 && candidate.wordCount <= 14 && (candidate.contentCount >= 2 || (candidate.hookBonus > 0 && candidate.contentCount >= 1)))
    .sort(
      (left, right) =>
        right.contentCount + right.hookBonus - (left.contentCount + left.hookBonus) ||
        left.wordCount - right.wordCount ||
        left.index - right.index
    );

  return ranked[0]?.sentence?.trim() ?? "";
};

const titleCase = (text: string): string =>
  text
    .split(/\s+/)
    .map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}` : word))
    .join(" ");

const splitTags = (input?: string): string[] => input?.split(/[\s,]+/).filter(Boolean) ?? [];

export const buildClipTitle = (input: { transcript?: string; titleHint?: string | null }): string => {
  const source = bestSentence(input.transcript ?? "") || input.titleHint?.trim() || "Generated clip";
  return sanitizeUploadTitle(titleCase(source), "Generated clip", 100);
};

export const buildClipHashtags = (input: {
  transcript?: string;
  projectTitle?: string;
  projectHashtags?: string;
}): string => {
  const keywordCounts = new Map<string, number>();
  for (const word of tokenize(input.transcript ?? "")) {
    keywordCounts.set(word, (keywordCounts.get(word) ?? 0) + 1);
  }

  const clipKeywords = [...keywordCounts.entries()]
    .sort(([leftWord, leftCount], [rightWord, rightCount]) => rightCount - leftCount || leftWord.localeCompare(rightWord))
    .map(([word]) => word)
    .slice(0, 5);

  const tags = normalizeHashtags(
    [...splitTags(input.projectHashtags), ...clipKeywords],
    { ensureShorts: true, max: 8 }
  );

  return tags.map((tag) => `#${tag}`).join(" ");
};

export const buildClipMetadata = (input: {
  transcript?: string;
  titleHint?: string | null;
  projectTitle?: string;
  projectHashtags?: string;
}) => ({
  title: buildClipTitle(input),
  hashtags: buildClipHashtags(input)
});

export const buildClipTargetKeywords = (input: { projectTitle?: string; projectHashtags?: string }): string[] =>
  [...splitTags(input.projectHashtags)]
    .map((value) => value.replace(/^#+/, ""))
    .filter(Boolean)
    .slice(0, 12);
