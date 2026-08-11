export class ScheduleService {
  public nextRun(timezone: string, uploadTime: string, activeDays: number[], after = new Date()): Date {
    const [hour, minute] = uploadTime.split(":").map(Number);
    for (let offset = 0; offset < 8; offset++) {
      const probe = new Date(after.getTime() + offset * 86_400_000);
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year:"numeric", month:"2-digit", day:"2-digit", weekday:"short" }).formatToParts(probe);
      const map = Object.fromEntries(parts.map((p) => [p.type, p.value])); const weekday = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(map.weekday);
      if (!activeDays.includes(weekday)) continue;
      const utcGuess = Date.UTC(Number(map.year), Number(map.month)-1, Number(map.day), hour, minute);
      const shown = new Date(utcGuess); const tzParts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12:false, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }).formatToParts(shown);
      const tz = Object.fromEntries(tzParts.map((p) => [p.type,p.value]));
      const represented = Date.UTC(Number(tz.year),Number(tz.month)-1,Number(tz.day),Number(tz.hour)%24,Number(tz.minute));
      const candidate = new Date(utcGuess - (represented - utcGuess));
      if (candidate > after) return candidate;
    }
    return new Date(after.getTime() + 86_400_000);
  }
  public startOfLocalDay(timezone: string, now = new Date()): Date {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now);
    const map = Object.fromEntries(parts.map((p) => [p.type,p.value]));
    return this.nextRun(timezone, "00:00", [0,1,2,3,4,5,6], new Date(Date.UTC(Number(map.year),Number(map.month)-1,Number(map.day)-1,23,59)));
  }
  public localDateKey(timezone: string, now = new Date()): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }
}
