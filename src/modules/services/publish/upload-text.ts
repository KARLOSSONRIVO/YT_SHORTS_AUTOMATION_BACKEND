export function sanitizeUploadTitle(
  rawTitle: string | null | undefined,
  fallbackTitle = "YouTube Short",
  maxCodePoints = 100
): string {
  const clean = (value: string) =>
    Array.from(value)
      .map((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code <= 0x1f || code === 0x7f ? " " : ch;
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const truncate = (value: string) => {
    const points = Array.from(value);
    return (points.length <= maxCodePoints ? value : points.slice(0, maxCodePoints).join("")).trim();
  };
  const primary = truncate(clean(rawTitle ?? ""));
  if (primary.length > 0) return primary;
  const fallback = truncate(clean(fallbackTitle));
  return fallback || "YouTube Short";
}

export function normalizeHashtags(
  tags: Iterable<string>,
  options: { max?: number; ensureShorts?: boolean } = {}
): string[] {
  const max = options.max ?? 30;
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (raw: string) => {
    const tag = (raw ?? "").replace(/^#+/, "").replace(/[^a-zA-Z0-9_]/g, "");
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(tag);
  };
  if (options.ensureShorts) push("shorts");
  for (const raw of tags) push(raw);
  return result.slice(0, max);
}
