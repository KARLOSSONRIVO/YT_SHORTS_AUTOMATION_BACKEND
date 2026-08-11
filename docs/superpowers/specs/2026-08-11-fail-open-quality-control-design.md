# Fail-Open Quality Control Design

## Goal

Allow rendered stories to continue through automation even when quality-control checks find problems. Quality-control findings remain visible for diagnosis, but they do not mark a story as failed or prevent an upload attempt.

## Current Behavior

`QualityControlService.check` classifies account, source, script, voice, media, orientation, audio, blank-scene, watermark, rights, and duration problems as critical. A non-empty critical list makes `passed` false. Both automation reconciliation and the upload path treat that result as a hard failure.

## Approved Behavior

Quality control is advisory:

- `passed` is always `true`.
- `critical` is always empty.
- Every detected quality issue is retained in `warnings` using its existing message.
- Existing subtitle warnings remain warnings.
- Reconciliation and upload continue using their existing success paths without special bypass branches.

This does not make impossible operations succeed. Missing render assets, invalid credentials, provider errors, duplicate-upload protection, and YouTube API failures can still stop the workflow outside quality control.

## Implementation

Change only `QualityControlService` so all checks append to `warnings` instead of `critical`. Keep the result shape stable to avoid changing callers or stored QC records.

## Tests

Add focused regression coverage proving:

1. A short render outside the duration tolerance passes and records the duration warning.
2. Multiple severe QC findings pass, leave `critical` empty, and remain visible as warnings.
3. A valid render still passes without newly introduced warnings.

Run the focused backend test file, then the backend test suite and TypeScript/build checks available in the project.

## Non-Goals

- Changing narration duration, render timing, or FFmpeg behavior.
- Suppressing QC findings from stored history.
- Bypassing failures outside `QualityControlService`.
