# YouTube Source Clipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a YouTube-link clipping workflow with selectable subtitle styling and explicit per-clip review/publishing while preserving the existing local-file workflow.

**Architecture:** Add a JSON source endpoint to the existing upload module, download the source through a small `yt-dlp` adapter, then reuse the existing storage, project, queue, transcription, analysis, review, render, and publish services. Add a separate frontend source page and a focused subtitle-style component, and stop the analysis worker from auto-rendering every candidate.

**Tech Stack:** Node.js, TypeScript, Express, Mongoose, BullMQ, `yt-dlp`, Next.js 15, React 19, Tailwind CSS, React Hook Form, Zod, Vitest/Node tests, Graphify, `uxskill`.

**Spec:** `BACKEND/docs/superpowers/specs/2026-09-11-youtube-source-clipping-design.md`

## Global Constraints

- Keep the existing local finished-clip upload workflow available.
- Do not automatically publish or render every generated candidate; rendering begins only after explicit approval of a selected clip.
- The server may download the linked source internally because transcription and clipping require local media, but the UI must not auto-upload all generated clips.
- Accept only YouTube URLs and always pass `--no-playlist` to `yt-dlp`.
- Preserve unrelated dirty changes in both nested repositories.
- Do not add dependencies unless the existing project cannot provide the required capability.
- Do not commit or push any changes.
- Delete every test file created during this task after verification; do not modify or delete pre-existing test files.

---

### Task 1: Add red tests for source validation and downloader behavior

**Files:**
- Create: `BACKEND/tests/youtube-source.test.ts`
- Create: `yt_automation_frontend/tests/youtube-source-form.test.mjs`

**Interfaces:**
- The backend tests will consume `isYouTubeSourceUrl()` and `YouTubeSourceDownloader`.
- The frontend test will inspect the new source form and source API contract after those files exist.

- [ ] **Step 1: Write the failing backend tests**

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isYouTubeSourceUrl } from "../src/modules/validators/upload.validator";
import { YouTubeSourceDownloader } from "../src/infrastructure/youtube/youtube-source-downloader";

test("accepts supported YouTube URL shapes and rejects other hosts", () => {
  assert.equal(isYouTubeSourceUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isYouTubeSourceUrl("https://youtu.be/abc"), true);
  assert.equal(isYouTubeSourceUrl("https://example.com/watch?v=abc"), false);
});

test("downloader disables playlists and returns the downloaded MP4", async () => {
  const calls: string[][] = [];
  const downloader = new YouTubeSourceDownloader("yt-dlp", async (_executable, args) => {
    calls.push(args);
    const output = args[args.indexOf("--output") + 1].replace("%(ext)s", "mp4");
    await fs.writeFile(output, "video");
    return { stdout: "", stderr: "" };
  });
  const result = await downloader.download("https://youtu.be/abc");
  assert.equal(result.mimeType, "video/mp4");
  assert.equal(result.originalFileName.endsWith(".mp4"), true);
  assert.equal(calls[0].includes("--no-playlist"), true);
  await downloader.cleanup(result);
});
```

- [ ] **Step 2: Run the backend test and confirm it fails because the new exports do not exist**

Run: `npm test -- --test-name-pattern="YouTube"` from `BACKEND`.

Expected: FAIL with module/export-not-found errors for the validator and downloader.

- [ ] **Step 3: Write the failing frontend contract test**

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("source form exposes link-first processing and explicit review copy", () => {
  const source = fs.readFileSync("src/features/uploads/components/youtube-source-form.tsx", "utf8");
  assert.match(source, /YouTube video link/i);
  assert.match(source, /subtitle/i);
  assert.match(source, /nothing is published automatically/i);
});
```

- [ ] **Step 4: Run the frontend test and confirm it fails because the source form does not exist**

Run: `node --test tests/youtube-source-form.test.mjs` from `yt_automation_frontend`.

Expected: FAIL with an `ENOENT` error for the new source form.

### Task 2: Implement the backend YouTube source adapter and endpoint

**Files:**
- Create: `BACKEND/src/infrastructure/youtube/youtube-source-downloader.ts`
- Modify: `BACKEND/src/modules/validators/upload.validator.ts`
- Modify: `BACKEND/src/modules/controllers/upload/upload.controller.ts`
- Modify: `BACKEND/src/modules/services/upload/upload.service.ts`
- Modify: `BACKEND/src/modules/models/source-video.model.ts`
- Modify: `BACKEND/src/modules/services/storage/storage.service.ts`
- Modify: `BACKEND/src/routes/upload/upload.routes.ts`
- Modify: `BACKEND/src/config/env.ts`
- Modify: `BACKEND/src/container.ts`
- Modify: `BACKEND/src/modules/services/workflow/workflow-orchestrator.service.ts`
- Modify: `BACKEND/Dockerfile`

**Interfaces:**
- `YouTubeSourceDownloader.download(sourceUrl: string): Promise<DownloadedYouTubeSource>` returns `filePath`, `directory`, `originalFileName`, `mimeType`, and `sizeBytes`.
- `YouTubeSourceDownloader.cleanup(downloaded: DownloadedYouTubeSource): Promise<void>` removes its temporary directory.
- `POST /upload/source` accepts `sourceUrl`, `title`, optional `description`, `hashtags`, `targetClipCount`, `language`, and `subtitlePreferences` and returns the existing upload response shape.

- [ ] **Step 1: Add the URL validator and source request schema**

Use `new URL()` and normalize the hostname by removing a leading `www.`. Accept `youtube.com`, `m.youtube.com`, `youtu.be`, and subdomains ending in `.youtube.com`; reject all other hosts. Extend the existing position enum to include `middle_center`, and validate the nested subtitle preference fields.

- [ ] **Step 2: Implement the downloader with an injectable runner**

Use `execFile` with an injectable runner for tests. Create a unique temporary directory, invoke:

```ts
["--no-playlist", "--no-progress", "--quiet", "--format", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "--merge-output-format", "mp4", "--output", `${base}.%(ext)s`, sourceUrl]
```

Find the resulting MP4, return its stat size, and include stderr in thrown errors. Clean the temporary directory on failed downloads.

- [ ] **Step 3: Add storage support for a downloaded path**

Refactor `StorageService.storeSourceVideo()` so both Multer uploads and downloaded files use `storeSourceVideoFile({ path, originalname, mimetype })`; preserve the existing storage key and cleanup behavior.

- [ ] **Step 4: Add the source workflow and controller route**

Download before creating a project. Store the file, create the project with the resolved subtitle preferences, create the source-video record with `sourceUrl`, create the queued ingest job with `languageHint`, enqueue it, and clean the temporary directory in `finally`. Add `createYouTubeSource()` to the controller and `POST /source` before the existing multipart route.

- [ ] **Step 5: Wire the downloader and environment settings**

Add `YTDLP_PATH` (default `yt-dlp`) and `YTDLP_TIMEOUT_MS` (default `900000`) to environment parsing. Construct the downloader in the container and inject it into `UploadService`. Install `ffmpeg`, Python, pip, and a virtualenv-installed `yt-dlp` in the production image, with `YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp`.

- [ ] **Step 6: Carry language through ingest and stop automatic candidate rendering**

Add optional `languageHint` to the ingest payload. After analysis creates candidate clips, transition the project to `review` instead of calling `renderService.queueRender()` for every candidate. Leave `ClipController.reviewClip()` as the explicit approval path that queues rendering for only the chosen clip.

- [ ] **Step 7: Run backend tests and typecheck**

Run: `npm test -- --test-name-pattern="YouTube"`, `npm run typecheck`, and `npm run build` from `BACKEND`.

Expected: the temporary YouTube tests pass; typecheck and build complete without new errors.

### Task 3: Add the frontend source form and subtitle design chooser

**Files:**
- Create: `yt_automation_frontend/src/features/uploads/components/subtitle-style-fields.tsx`
- Create: `yt_automation_frontend/src/features/uploads/components/youtube-source-form.tsx`
- Create: `yt_automation_frontend/src/app/(dashboard)/projects/new/youtube-source/page.tsx`
- Modify: `yt_automation_frontend/src/features/uploads/api/create-upload.ts`
- Modify: `yt_automation_frontend/src/features/uploads/types.ts`
- Modify: `yt_automation_frontend/src/lib/constants/routes.ts`
- Modify: `yt_automation_frontend/src/features/automation/components/create-project-form.tsx`

**Interfaces:**
- `SubtitleStyleFields` accepts `value: SubtitleStyleValues` and `onChange(next: SubtitleStyleValues): void`.
- `createYouTubeSourceUpload(input)` posts JSON to `/upload/source` and returns the existing `UploadResponse`.
- `YouTubeSourceForm` submits the link and preferences, then routes to `/projects/:projectId/review`.

- [ ] **Step 1: Add the frontend API/types and route constant**

Add `sourceUrl` to the source-video response type, define the nested subtitle preferences input, and add `appRoutes.youtubeSource = "/projects/new/youtube-source"`.

- [ ] **Step 2: Implement visible subtitle presets with progressive disclosure**

Create three local presets (`Bold Center`, `Highlight Pop`, `Clean Outline`) that resolve to existing backend fields. Render them as keyboard-accessible `aria-pressed` buttons. Put font, size, colors, position, max characters, and max lines in a collapsed advanced section, and switch the preset to `custom` when an advanced field is edited.

- [ ] **Step 3: Implement the link-first source form**

Use the existing form primitives and React Hook Form/Zod patterns. Include a YouTube URL field, title, language, optional metadata, target candidate count, the subtitle chooser, permission copy, a processing state, and an inline recoverable error. The submit button must say `Analyze YouTube Source`; success routes to review without a publish action.

- [ ] **Step 4: Add the source page and legacy-path entry point**

Render the form at the new route. Add a visible `Analyze a YouTube link` link/button near the existing create-project form and relabel the old `CLIP_UPLOAD` option as `Upload Finished Clip` so the distinction is clear.

- [ ] **Step 5: Run the frontend contract test and typecheck**

Run: `node --test tests/youtube-source-form.test.mjs`, `npm run typecheck`, and `npm run build` from `yt_automation_frontend`.

Expected: the temporary contract test passes and the frontend builds with the new route and form.

### Task 4: Verify UX, runtime behavior, and graph state

**Files:**
- Modify only if verification finds an issue in the files from Tasks 2-3.
- Delete: `BACKEND/tests/youtube-source.test.ts`
- Delete: `yt_automation_frontend/tests/youtube-source-form.test.mjs`

- [ ] **Step 1: Run the focused UX lint**

Run `uxskill lint` against `yt_automation_frontend/src/features/uploads/components/youtube-source-form.tsx`, `yt_automation_frontend/src/features/uploads/components/subtitle-style-fields.tsx`, and the new page. Fix relevant findings introduced by this work.

- [ ] **Step 2: Verify the source-to-review flow**

Confirm the source form sends JSON to `/upload/source`, the backend records `sourceUrl`, the ingest payload carries language, analysis transitions to review without an automatic render fan-out, and approval remains the only path that queues rendering.

- [ ] **Step 3: Verify responsive and accessibility behavior**

Inspect the form at desktop and narrow widths. Confirm preset buttons, form labels, focus states, error text, and the advanced disclosure are keyboard reachable and understandable without color alone.

- [ ] **Step 4: Remove only the temporary tests created in Task 1**

Delete the two new temporary test files with `apply_patch`. Leave every pre-existing test file untouched.

- [ ] **Step 5: Update Graphify**

Run `graphify update` from the workspace root after the final files and behavior are in place.

- [ ] **Step 6: Review the final diff without committing**

Run `git status --short` in the root and both nested repositories, then review `git diff --check`. Confirm no commit or push was performed and report any unrelated baseline failures separately.
