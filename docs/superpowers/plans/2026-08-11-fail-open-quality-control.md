# Fail-Open Quality Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every quality-control finding advisory so QC never marks a rendered story failed or blocks its upload attempt.

**Architecture:** Preserve the existing `QualityControlService.check` interface and both callers. Move all detected problems into `warnings`, keep `critical` empty, and derive `passed` from the empty critical list so reconciliation and upload naturally continue through their existing success branches.

**Tech Stack:** TypeScript 5.8, Node.js test runner, `tsx`, Node strict assertions.

## Global Constraints

- `passed` is always `true` for every `QcInput`.
- `critical` is always an empty array.
- Every existing finding message remains visible in `warnings`.
- Do not change rendering, FFmpeg, reconciliation, upload, credential, provider, or duplicate-upload behavior.

---

### Task 1: Make Quality Control Advisory

**Files:**
- Modify: `tests/automation.test.ts:37`
- Modify: `src/modules/automation/quality-control.service.ts:3-19`

**Interfaces:**
- Consumes: `QualityControlService.check(input: QcInput)` and the existing `QcInput` shape.
- Produces: the existing `{ passed, critical, warnings, checkedAt }` result shape with advisory-only findings.

- [x] **Step 1: Replace the rejecting QC test and add focused fail-open cases**

```ts
test("QC allows a render outside duration tolerance and records a warning", () => {
  const result = new QualityControlService().check({
    content: { ...candidate, script: "x", voiceId: "v", targetDurationSeconds: 60 } as never,
    finalVideo: { durationSeconds: 48.44, width: 1080, height: 1920, hasAudio: true, blankSceneCount: 0, subtitleCount: 1, unauthorizedWatermark: false, mediaRightsVerified: true },
    accountActive: true
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.critical, []);
  assert.ok(result.warnings.includes("render duration is outside tolerance"));
});

test("QC allows every detected finding and preserves them as warnings", () => {
  const result = new QualityControlService().check({
    content: { ...candidate, sourceLinks: [], script: "", voiceId: "", targetDurationSeconds: 60 } as never,
    accountActive: false
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.critical, []);
  assert.ok(result.warnings.includes("assigned account credentials are inactive"));
  assert.ok(result.warnings.includes("important facts do not have valid source URLs"));
  assert.ok(result.warnings.includes("narration script is missing"));
  assert.ok(result.warnings.includes("voice selection is missing"));
  assert.ok(result.warnings.includes("final video is missing"));
});

test("QC allows a valid render without quality warnings", () => {
  const result = new QualityControlService().check({
    content: { ...candidate, script: "x", voiceId: "v", targetDurationSeconds: 60 } as never,
    finalVideo: { durationSeconds: 60, width: 1080, height: 1920, hasAudio: true, blankSceneCount: 0, subtitleCount: 1, unauthorizedWatermark: false, mediaRightsVerified: true },
    accountActive: true
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.critical, []);
  assert.deepEqual(result.warnings, []);
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --import tsx --test --test-name-pattern="QC allows" tests/automation.test.ts`

Expected: the two fail-open tests fail because current QC returns `passed: false`, populates `critical`, and does not put those findings in `warnings`; the valid-render characterization test passes.

- [x] **Step 3: Implement the minimal fail-open behavior**

In `QualityControlService.check`, keep `critical` empty and append every detected condition to `warnings`:

```ts
const critical: string[] = [];
const warnings: string[] = [];
// Existing conditions use warnings.push(existingMessage).
return { passed: critical.length === 0, critical, warnings, checkedAt: new Date().toISOString() };
```

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `node --import tsx --test --test-name-pattern="QC allows" tests/automation.test.ts`

Expected: all three tests pass.

- [x] **Step 5: Run backend verification**

Run: `npm test`

Expected: all tests pass.

Run: `npm run typecheck`

Expected: TypeScript reports no errors.

Run: `npm run build`

Expected: build completes successfully.

Run: `git diff --check`

Expected: no whitespace errors.

- [x] **Step 6: Preserve the implementation in the existing workspace**

The affected source and test files were already untracked and contained broader user work. Leave them uncommitted so this task does not accidentally commit unrelated changes.
