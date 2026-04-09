export const toPlain = <T extends { toObject?: () => unknown } | null>(document: T): unknown => {
  if (!document) {
    return null;
  }

  if (typeof document.toObject === "function") {
    return document.toObject();
  }

  return document;
};
