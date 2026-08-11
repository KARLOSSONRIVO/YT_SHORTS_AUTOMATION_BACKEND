# Immediate Manual Upload and Shared Quality Check Design

## Goal

Make a story started through **Generate Now** upload immediately after rendering and quality control, while preserving the configured upload time for automatic daily generation.

## Root cause

The Python worker writes rendered videos beneath `/app/outputs`, backed by `yt_automation/outputs` on the host. The API, backend worker, and automation scheduler only mount `BACKEND/storage`, so the scheduler cannot inspect the absolute `/app/outputs/...` path stored on the final-video asset. `ffprobe` therefore fails during reconciliation and leaves the story in `quality_check`.

The automation queue records whether a job is `manual` or `scheduled`, but `src/worker.ts` discards that field when it calls `AutomationService.execute`. The service consequently assigns the next configured upload time to every generated story.

## Design

- Mount `../yt_automation/outputs` read-only at `/app/outputs` in the backend API, backend worker, and automation scheduler containers.
- Extend `AutomationService.execute` with a generation trigger. A manual trigger assigns `scheduledUploadTime` to the current time; a scheduled trigger continues using `ScheduleService.nextRun`.
- Forward the validated BullMQ trigger from `src/worker.ts` into `execute`.
- Preserve approval behavior: an approval-required project still waits for approval. Fully automatic manual generation becomes immediately due after quality control.
- Isolate reconciliation failures per content record so one inaccessible or corrupt video cannot prevent later records from progressing.
- Make the already-rendered Aguinaldo record immediately due after deployment, allowing the scheduler to complete quality control and invoke the existing YouTube publisher exactly once.

## Error handling

Per-record reconciliation errors are returned in the reconciliation result and logged by the scheduler, while processing continues for the remaining records. Existing upload claiming and platform-video checks continue to prevent duplicate uploads.

## Verification

- Regression tests prove manual generation stores an immediate upload time and scheduled generation preserves the configured future time.
- A reconciliation regression test proves one failing record does not block the following record.
- `docker compose config` proves all three backend services receive `/app/outputs`.
- After recreation, file checks prove the scheduler can see the rendered video, logs prove quality control no longer fails with `ENOENT`, and MongoDB confirms an upload attempt/status transition.
