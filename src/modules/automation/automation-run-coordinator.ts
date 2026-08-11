import type IORedis from "ioredis";
import { AppError } from "../../common/errors/app-error";

const ACTIVE_STORY_KEY = "automation:active-story-project";
const ACTIVE_STORY_TTL_SECONDS = 6 * 60 * 60;

export class AutomationRunCoordinator {
  constructor(private readonly redis: IORedis) {}

  public async begin(projectId: string, runId: string) {
    const lockValue = `${projectId}|${runId}`;
    const acquired = await this.redis.set(
      ACTIVE_STORY_KEY,
      lockValue,
      "EX",
      ACTIVE_STORY_TTL_SECONDS,
      "NX"
    );
    if (acquired === "OK") return;
    const refreshed = await this.redis.eval(
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('expire',KEYS[1],ARGV[2]) else return 0 end",
      1,
      ACTIVE_STORY_KEY,
      lockValue,
      String(ACTIVE_STORY_TTL_SECONDS)
    );
    if (refreshed === 1) return;
    const activeProjectId = await this.redis.get(ACTIVE_STORY_KEY);
    throw new AppError("Another story job is active. This project remains queued until it finishes.", 429, "AUTOMATION_JOB_QUEUED", { activeProjectId });
  }

  public async finish(projectId: string) {
    await this.redis.eval("local v=redis.call('get',KEYS[1]); if v and string.sub(v,1,string.len(ARGV[1])+1)==ARGV[1]..'|' then return redis.call('del',KEYS[1]) else return 0 end", 1, ACTIVE_STORY_KEY, projectId);
  }
}
