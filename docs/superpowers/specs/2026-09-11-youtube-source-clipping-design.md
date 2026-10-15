# YouTube Source Clipping and Subtitle Design

## Goal

Let a user paste a YouTube video link, choose the subtitle treatment before processing, review the generated candidates, and explicitly approve/publish only selected clips. Keep the existing finished-local-video upload path available for legacy use.

## Product behavior

- The new source flow is a separate, clearly labeled action: `Analyze a YouTube link`.
- The form accepts a YouTube watch, short, or `youtu.be` URL, a project title, language, optional description/hashtags, and a target candidate count.
- Subtitle design is selected before submission from visible presets, with an advanced section for font, size, colors, position, line length, and maximum lines.
- The server downloads the source internally only as a processing step, stores the source URL, transcribes it, and creates candidate clips.
- Candidate rendering is not queued for every candidate automatically. The project enters review after analysis.
- A user explicitly approves a clip in the existing review screen; approval queues rendering. Publishing remains an explicit per-clip action.
- The existing local finished-clip upload path remains available and is relabeled so the two workflows are not confused.
- The form explains that the user must have permission to process and publish the linked video.

## Technical design

- Add `POST /upload/source` to the existing upload module. It receives JSON and uses the existing project, source-video, job, queue, storage, and workflow services.
- Add a small `YouTubeSourceDownloader` infrastructure adapter around the installed `yt-dlp` executable. It uses `--no-playlist`, downloads an MP4 into a temporary directory, and returns a path for the existing storage service.
- Persist `sourceUrl` on `SourceVideo` and pass the selected language through the ingest job payload.
- Remove the analysis-stage fan-out that queues render jobs for every created candidate. The review controller already queues render for an approved clip.
- Add a frontend `YouTubeSourceForm` page and a reusable `SubtitleStyleFields` component. The frontend sends resolved subtitle preferences; the preset is a UI convenience and the persisted values remain the source of truth.
- Keep dependencies unchanged. Configure the downloader executable and timeout through environment settings, defaulting to `yt-dlp` and a 15-minute timeout.

## Safety and validation

- Accept only `youtube.com`, its supported subdomains, `m.youtube.com`, and `youtu.be` URLs.
- Reject playlists by downloader arguments even when the supplied URL contains a playlist parameter.
- Show downloader failures as a recoverable form error; do not create a project until the source has been downloaded successfully.
- Do not change or delete unrelated dirty worktree changes.

## Verification

- Add temporary focused backend and frontend tests before implementation, run them red, then green; delete only those newly created test files after verification as required by the repository instructions.
- Run backend typecheck, targeted tests, and build.
- Run frontend typecheck, targeted tests, build, and `uxskill lint` for the affected frontend scope.
- Inspect the new source form and review flow at desktop and narrow responsive widths when a browser is available.
- Update Graphify after the implementation and verification.
