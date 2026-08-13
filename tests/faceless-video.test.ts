import assert from "node:assert/strict";
import test from "node:test";
import { FacelessVideoService, type FacelessStage } from "../src/modules/services/facelessVideo/faceless-video.service";

test("Reddit background-video stories go directly from subtitles to render", () => {
  const service = new FacelessVideoService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  const getNextStage = (service as unknown as {
    getNextStage: (project: { facelessSource?: "daily_automation" | "archived_legacy"; facelessRenderMode?: "image_story" | "animation_story" | "background_video" }, stage: FacelessStage) => FacelessStage | undefined;
  }).getNextStage.bind(service);

  assert.equal(
    getNextStage({ facelessSource: "daily_automation", facelessRenderMode: "background_video" }, "subtitles"),
    "render"
  );
});

test("Reddit story projects write their assets to the reddit output bucket", () => {
  const service = new FacelessVideoService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  const outputBucketForProject = (service as unknown as {
    outputBucketForProject: (project: { projectType: "uploaded_video" | "faceless_story"; facelessSource?: string; contentType?: string }) => string;
  }).outputBucketForProject.bind(service);

  assert.equal(
    outputBucketForProject({ projectType: "faceless_story", facelessSource: "daily_automation", contentType: "REDDIT_STORY" }),
    "reddit"
  );
});
