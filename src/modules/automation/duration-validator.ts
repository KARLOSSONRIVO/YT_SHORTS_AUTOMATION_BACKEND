export class DurationValidator {
  public estimate(text: string, speakingRateWordsPerMinute: number): number {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const punctuationPauses = (text.match(/[.!?;:]/g) ?? []).length * 0.18;
    return Number((words / Math.max(speakingRateWordsPerMinute, 60) * 60 + punctuationPauses).toFixed(2));
  }
  public targetWordRange(targetSeconds: number, speakingRateWordsPerMinute: number, tolerance = 0.08) {
    const center = targetSeconds / 60 * speakingRateWordsPerMinute;
    return { min: Math.floor(center * (1 - tolerance)), target: Math.round(center), max: Math.ceil(center * (1 + tolerance)) };
  }
  public validate(text: string, targetSeconds: number, speakingRateWordsPerMinute: number, toleranceSeconds = 5) {
    const estimatedSeconds = this.estimate(text, speakingRateWordsPerMinute);
    return { estimatedSeconds, valid: Math.abs(estimatedSeconds - targetSeconds) <= toleranceSeconds,
      adjustment: estimatedSeconds > targetSeconds + toleranceSeconds ? "shorten" as const : estimatedSeconds < targetSeconds - toleranceSeconds ? "expand" as const : "none" as const };
  }
}
