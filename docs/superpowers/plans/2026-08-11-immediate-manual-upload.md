# Immediate Manual Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Generate Now upload immediately after render/QC and let the scheduler inspect Python-worker render outputs.

**Architecture:** Preserve the queue's manual/scheduled trigger through the worker boundary and derive the content upload timestamp from that trigger. Share the existing render-output directory read-only with backend services and contain reconciliation errors to one content record.

**Tech Stack:** TypeScript, Node test runner, BullMQ, MongoDB, Docker Compose.

## Global Constraints

- Automatic daily jobs retain the project's configured upload time.
- Manual jobs are immediately due only after normal rendering and quality control.
- Approval-required projects continue to require approval.
- Existing upload idempotency and one-upload-per-account-per-day checks remain active.

---

### Task 1: Trigger-aware upload scheduling

**Files:**
- Modify: `tests/automation.test.ts`
- Modify: `src/modules/automation/automation.service.ts`
- Modify: `src/worker.ts`

**Interfaces:**
- Consumes: automation job payload field `trigger: "manual" | "scheduled"`.
- Produces: `AutomationService.execute(projectId, scheduledDate, trigger)` with an immediate timestamp for manual jobs.

- [ ] Add regression tests for manual and scheduled timestamps.
- [ ] Run the focused tests and confirm the manual case fails.
- [ ] Forward the trigger and derive the timestamp.
- [ ] Run focused tests and confirm both cases pass.

### Task 2: Reconciliation isolation

**Files:**
- Modify: `tests/automation.test.ts`
- Modify: `src/modules/automation/automation.service.ts`
- Modify: `src/scheduler.ts`

**Interfaces:**
- Consumes: pending content records from `findPendingFinalization`.
- Produces: reconciliation that continues after a record-specific exception and exposes failures for logging.

- [ ] Add a failing regression test with one broken and one valid record.
- [ ] Run the focused test and confirm the second record is blocked.
- [ ] Isolate each content reconciliation attempt.
- [ ] Log returned reconciliation failures from the scheduler.
- [ ] Run focused tests and confirm both records are processed.

### Task 3: Shared output mount

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: host directory `../yt_automation/outputs`.
- Produces: read-only `/app/outputs` in `backend`, `backend-worker`, and `automation-scheduler`.

- [ ] Add the read-only bind mount to all three services.
- [ ] Run `docker compose config` and verify the resolved mount targets.

### Task 4: Deployment and current story recovery

**Files:**
- No source files beyond Tasks 1-3.

**Interfaces:**
- Consumes: the existing Aguinaldo content-history record.
- Produces: a recreated scheduler that can inspect the video and an immediately due current story.

- [ ] Run the full backend tests, typecheck, build, and diff checks.
- [ ] Rebuild and recreate the backend services.
- [ ] Confirm `/app/outputs/.../faceless_story.mp4` exists in the scheduler.
- [ ] Update only the affected content record's scheduled upload time to now.
- [ ] Observe reconciliation, QC, and the YouTube upload result.
