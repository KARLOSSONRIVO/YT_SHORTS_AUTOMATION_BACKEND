# Backend Starter Architecture

This starter follows a clean service-layer structure:

- Controllers handle HTTP concerns only.
- Services hold application workflows and business rules.
- Repositories encapsulate MongoDB access.
- Infrastructure adapters isolate Redis, BullMQ, FFmpeg, the Python worker, storage, and YouTube.

Primary workflow queues:

- `ingest`
- `transcription`
- `analysis`
- `render`
- `upload`

The upload workflow creates a project, persists source video metadata, creates an ingest job, and places the job onto BullMQ for asynchronous processing.
