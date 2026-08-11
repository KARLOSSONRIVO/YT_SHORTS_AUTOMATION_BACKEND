import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/common/errors/app-error";
import { AutomationRunCoordinator } from "../src/modules/automation/automation-run-coordinator";

class CoordinatorRedisDouble {
  public value: string | null;
  public ttlSeconds: number | null;

  constructor(value: string | null = null, ttlSeconds: number | null = null) {
    this.value = value;
    this.ttlSeconds = ttlSeconds;
  }

  public async set(_key: string, value: string, ...args: Array<string | number>) {
    if (this.value !== null) return null;
    this.value = value;
    const expiryIndex = args.indexOf("EX");
    this.ttlSeconds = expiryIndex >= 0 ? Number(args[expiryIndex + 1]) : null;
    return "OK";
  }

  public async get(_key: string) {
    return this.value;
  }

  public async eval(script: string, _keyCount: number, _key: string, ...args: Array<string | number>) {
    if (script.includes("expire")) {
      const [expectedValue, ttlSeconds] = args;
      if (this.value !== String(expectedValue)) return 0;
      this.ttlSeconds = Number(ttlSeconds);
      return 1;
    }

    const projectId = String(args[0]);
    if (!this.value?.startsWith(`${projectId}|`)) return 0;
    this.value = null;
    this.ttlSeconds = null;
    return 1;
  }
}

test("the active-story lock expires six hours after acquisition", async () => {
  const redis = new CoordinatorRedisDouble();
  const coordinator = new AutomationRunCoordinator(redis as never);

  await coordinator.begin("p1", "run-1");

  assert.equal(redis.value, "p1|run-1");
  assert.equal(redis.ttlSeconds, 21_600);
});

test("an identical retry renews the active-story lease", async () => {
  const redis = new CoordinatorRedisDouble("p1|run-1", 10);
  const coordinator = new AutomationRunCoordinator(redis as never);

  await coordinator.begin("p1", "run-1");

  assert.equal(redis.ttlSeconds, 21_600);
});

test("a different project cannot renew or remove the owner lease", async () => {
  const redis = new CoordinatorRedisDouble("p1|run-1", 900);
  const coordinator = new AutomationRunCoordinator(redis as never);

  await assert.rejects(
    () => coordinator.begin("p2", "run-2"),
    (error) => error instanceof AppError && error.code === "AUTOMATION_JOB_QUEUED"
  );
  await coordinator.finish("p2");

  assert.equal(redis.value, "p1|run-1");
  assert.equal(redis.ttlSeconds, 900);
});
