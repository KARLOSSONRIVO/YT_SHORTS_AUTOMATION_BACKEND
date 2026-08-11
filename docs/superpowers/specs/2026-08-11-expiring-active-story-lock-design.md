# Expiring Active-Story Lock Design

## Goal

Prevent a crashed or deleted automation project from leaving the global
active-story Redis lock permanently set while still preventing two legitimate
story generations from running concurrently.

## Lease behavior

`AutomationRunCoordinator.begin()` will acquire
`automation:active-story-project` as a six-hour Redis lease using
`SET key value EX 21600 NX`. A successful acquisition starts the lease.

When the same project and run retry, `begin()` will recognize the identical
lock value and refresh its six-hour expiration. The refresh must compare and
expire atomically in Lua so a changed lock owner cannot be extended by the
previous owner.

When a different run owns the lock, the coordinator will preserve the existing
behavior and raise `AUTOMATION_JOB_QUEUED`. It must not modify the current
owner's expiration.

`finish()` will keep its existing owner-safe Lua deletion. A project may delete
the lock only when the stored value begins with that project ID and separator.

## Failure behavior

If a worker exits without calling `finish()`, Redis removes the lock after six
hours. A render still active after six hours without any retry or coordinator
activity is considered stalled. BullMQ retries that re-enter `begin()` refresh
the lease for the same run.

No database records, BullMQ job payloads, queue retry settings, or scheduler
intervals change.

## Verification

Coordinator tests will prove that:

1. a new lock is acquired with `EX 21600 NX`;
2. an identical retry atomically refreshes the lease;
3. a different project remains queued and cannot refresh the owner lease;
4. `finish()` still permits only the owning project to delete the lock.

After the focused tests, the complete backend test suite, typecheck, build,
Compose validation, and diff check will run. The backend worker and scheduler
will then be rebuilt and restarted. A controlled Redis inspection will verify
that a newly acquired coordinator lock reports a positive TTL no greater than
21,600 seconds, after which the test lock will be owner-safely removed.
