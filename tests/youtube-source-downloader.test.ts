import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { YouTubeSourceDownloader } from "../src/infrastructure/youtube/youtube-source-downloader";

test("imports a YouTube source above 1 GiB in one download", async (t) => {
  const sizeBytes = 1024 ** 3 + 1;
  const runner = t.mock.fn(async (_executable: string, args: string[]) => {
    assert.equal(args.includes("--simulate"), false);
    assert.equal(args.includes("--max-filesize"), false);

    const output = args[args.indexOf("--output") + 1].replace("%(ext)s", "mp4");
    await fs.writeFile(output, "video fixture");
    const metadata = await fs.stat(output);
    metadata.size = sizeBytes;
    t.mock.method(fs, "stat", async () => metadata);

    return { stdout: "", stderr: "" };
  });
  const downloader = new YouTubeSourceDownloader("yt-dlp", runner);
  const downloaded = await downloader.download("https://www.youtube.com/watch?v=abcdefghijk");

  try {
    assert.equal(downloaded.sizeBytes, sizeBytes);
    assert.equal(runner.mock.callCount(), 1);
  } finally {
    await downloader.cleanup(downloaded);
  }
});
