# Expiring Active-Story Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the permanent global active-story Redis lock with a renewable six-hour lease that automatically recovers from worker crashes.

**Architecture:** `AutomationRunCoordinator` remains the sole owner of active-story locking. New acquisitions use Redis `SET NX EX`; identical retries use an owner-comparing Lua script to refresh expiration atomically, and different owners retain the existing queued response. Owner-safe release remains unchanged.

**Tech Stack:** TypeScript, Node.js, ioredis, Redis Lua, Node test runner, BullMQ, Docker Compose.

## Global Constraints

- Redis key remains `automation:active-story-project`.
- Lease duration is exactly 21,600 seconds (six hours).
- New acquisition uses `SET key value EX 21600 NX`.
- Only an identical `projectId|runId` value may refresh the expiration.
- Different projects remain queued with `AUTOMATION_JOB_QUEUED`.
- Owner-safe `finish(projectId)` behavior remains unchanged.
- BullMQ payloads, retry settings, database records, and scheduler intervals do not change.

---

### Task 1: Six-hour coordinator lease

**Files:**
- Create: `tests/automation-run-coordinator.test.ts`
- Modify: `src/modules/automation/automation-run-coordinator.ts`

**Interfaces:**
- Consumes: `AutomationRunCoordinator.begin(projectId: string, runId: string)` and `finish(projectId: string)`.
- Produces: the existing public coordinator API with expiring acquisition and owner-safe refresh behavior.

- [ ] **Step 1: Write failing lease tests**

Create a small in-memory Redis double that implements the coordinator's real
`set`, `get`, and `eval` contract. Its `set` method records whether `EX 21600
NX` was supplied and sets an observable TTL only when expiration arguments
are present. Its `eval` method models both the refresh script and existing
owner-safe delete script.

Add these behavior tests:

```typescript
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
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --import tsx --test tests/automation-run-coordinator.test.ts
```

Expected: acquisition and renewal tests fail because the production lock has no expiration and identical retries return without refreshing it.

- [ ] **Step 3: Implement acquisition and refresh**

Add a module-local constant:

```typescript
const ACTIVE_STORY_TTL_SECONDS = 6 * 60 * 60;
```

Acquire using:

```typescript
this.redis.set(
  ACTIVE_STORY_KEY,
  lockValue,
  "NX",
  "EX",
  ACTIVE_STORY_TTL_SECONDS
)
```

If acquisition fails, run an atomic Lua refresh that calls `EXPIRE` only when
`GET KEYS[1]` exactly equals `ARGV[1]`. Pass the lock value and the string form
of 21,600 as arguments. Return when the script reports `1`; otherwise read the
current owner and raise the existing queued error.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --import tsx --test tests/automation-run-coordinator.test.ts
```

Expected: all coordinator lease tests pass.

### Task 2: Full verification and deployment

**Files:**
- Verify: `src/modules/automation/automation-run-coordinator.ts`
- Verify: `tests/automation-run-coordinator.test.ts`
- Verify: `docker-compose.yml`

**Interfaces:**
- Consumes: the rebuilt backend worker and Redis container.
- Produces: a running coordinator whose active-story key always has a bounded TTL.

- [ ] **Step 1: Run backend verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
docker compose config --quiet
git diff --check
```

Expected: all tests pass and every command exits zero.

- [ ] **Step 2: Rebuild affected services**

Rebuild and restart `backend-worker` and `automation-scheduler`. Leave Redis,
Mongo, the API, the Python worker, and generated output files untouched.

- [ ] **Step 3: Verify the live Redis lease**

With no real story job queued, execute a controlled coordinator acquisition in
the rebuilt backend worker using test values `codex-lease-check` and
`codex-run-check`. Read Redis `GET` and `TTL` for
`automation:active-story-project`. Verify the value is
`codex-lease-check|codex-run-check` and TTL is positive and no greater than
21,600 seconds.

- [ ] **Step 4: Owner-safely remove the verification lease**

Invoke `finish("codex-lease-check")` through the rebuilt coordinator, then
verify Redis `EXISTS automation:active-story-project` returns `0` and that no
BullMQ automation job was created by the lease check.

- [ ] **Step 5: Verify service health**

Confirm the backend worker and scheduler are running and their post-restart logs
contain no startup, Redis, or coordinator errors.
