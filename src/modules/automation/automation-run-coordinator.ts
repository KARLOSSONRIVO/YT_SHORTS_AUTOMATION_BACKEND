import type IORedis from "ioredis";
import { AppError } from "../../common/errors/app-error";

const ACTIVE_STORY_SET = "automation:active-stories";
const ACTIVE_STORY_RUNS = "automation:active-story-runs";
const DEFAULT_MAX_CONCURRENT_PROJECTS = 3;
const DEFAULT_STALE_MS = 45 * 60 * 1000;

/**
 * Bounds how many projects may generate a story concurrently.
 *
 * A slot is held for the whole lifetime of a run: it is taken in
 * AutomationService.execute and released only once the run reaches a terminal
 * state (uploaded, drafted, or failed). Because that span covers the entire
 * faceless render chain, slots are heartbeated by the reconciler rather than
 * relying on a single long TTL, so a crashed run frees its slot in minutes
 * instead of hours.
 *
 * Membership lives in a sorted set scored by last-heartbeat timestamp, with a
 * companion hash mapping projectId -> runId so a second concurrent run of the
 * *same* project is still rejected.
 */
export class AutomationRunCoordinator {
  private readonly maxConcurrentProjects: number;
  private readonly staleMs: number;

  constructor(
    private readonly redis: IORedis,
    options: { maxConcurrentProjects?: number; staleMs?: number } = {}
  ) {
    this.maxConcurrentProjects = Math.max(1, options.maxConcurrentProjects ?? DEFAULT_MAX_CONCURRENT_PROJECTS);
    this.staleMs = Math.max(60_000, options.staleMs ?? DEFAULT_STALE_MS);
  }

  /**
   * Claims a generation slot for the project.
   *
   * Returns normally when the slot is held by this run - including the
   * re-entrant case where the same project and runId already holds it.
   * Throws AUTOMATION_JOB_QUEUED when every slot is taken, or when the same
   * project is already running under a different runId.
   */
  public async begin(projectId: string, runId: string) {
    const now = Date.now();
    const result = (await this.redis.eval(
      `
      local setKey, runsKey = KEYS[1], KEYS[2]
      local projectId, runId = ARGV[1], ARGV[2]
      local now, staleBefore, maxSlots = tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])

      -- Reclaim slots whose runs stopped heartbeating.
      local stale = redis.call('ZRANGEBYSCORE', setKey, '-inf', staleBefore)
      for i = 1, #stale do
        redis.call('ZREM', setKey, stale[i])
        redis.call('HDEL', runsKey, stale[i])
      end

      local heldRun = redis.call('HGET', runsKey, projectId)
      if heldRun then
        if heldRun == runId then
          redis.call('ZADD', setKey, now, projectId)
          return {'ok'}
        end
        return {'busy', projectId}
      end

      if redis.call('ZCARD', setKey) >= maxSlots then
        local active = redis.call('ZRANGE', setKey, 0, -1)
        table.insert(active, 1, 'full')
        return active
      end

      redis.call('ZADD', setKey, now, projectId)
      redis.call('HSET', runsKey, projectId, runId)
      return {'ok'}
      `,
      2,
      ACTIVE_STORY_SET,
      ACTIVE_STORY_RUNS,
      projectId,
      runId,
      String(now),
      String(now - this.staleMs),
      String(this.maxConcurrentProjects)
    )) as string[];

    const [outcome, ...activeProjectIds] = result;
    if (outcome === "ok") return;

    if (outcome === "busy") {
      throw new AppError(
        "This project already has a story job in flight. The new run stays queued until it finishes.",
        429,
        "AUTOMATION_JOB_QUEUED",
        { activeProjectId: projectId, activeProjectIds: [projectId], maxConcurrentProjects: this.maxConcurrentProjects }
      );
    }

    throw new AppError(
      `All ${this.maxConcurrentProjects} generation slots are busy. This project remains queued until one frees up.`,
      429,
      "AUTOMATION_JOB_QUEUED",
      { activeProjectId: activeProjectIds[0], activeProjectIds, maxConcurrentProjects: this.maxConcurrentProjects }
    );
  }

  /**
   * Refreshes the slot's heartbeat so an in-flight run is not reclaimed as
   * stale. No-op when the project does not hold a slot under this runId, so a
   * late heartbeat can never resurrect a finished run.
   */
  public async touch(projectId: string, runId: string) {
    await this.redis.eval(
      `
      if redis.call('HGET', KEYS[2], ARGV[1]) == ARGV[2] then
        return redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
      end
      return 0
      `,
      2,
      ACTIVE_STORY_SET,
      ACTIVE_STORY_RUNS,
      projectId,
      runId,
      String(Date.now())
    );
  }

  /** Releases the project's slot only when this run still owns it. */
  public async finish(projectId: string, runId?: string) {
    if (!runId) return;

    await this.redis.eval(
      `
      if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[2] then
        return 0
      end
      redis.call('ZREM', KEYS[1], ARGV[1])
      return redis.call('HDEL', KEYS[2], ARGV[1])
      `,
      2,
      ACTIVE_STORY_SET,
      ACTIVE_STORY_RUNS,
      projectId,
      runId
    );
  }

  /** Project ids currently holding a slot, oldest heartbeat first. */
  public activeProjectIds(): Promise<string[]> {
    return this.redis.zrange(ACTIVE_STORY_SET, 0, -1);
  }
}
