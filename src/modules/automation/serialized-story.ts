import {
  ORIGINAL_SERIALIZED_MYSTERY_NICHE_ID,
  type SerializedStoryAssignment,
  type SerializedStoryCandidate,
  type SerializedStoryState
} from "./automation.types";

export { ORIGINAL_SERIALIZED_MYSTERY_NICHE_ID };

export const DEFAULT_SERIALIZED_STORY_EPISODES_PER_SERIES = 3;
export const MIN_SERIALIZED_STORY_EPISODES_PER_SERIES = 1;
export const MAX_SERIALIZED_STORY_EPISODES_PER_SERIES = 12;

export const isOriginalSerializedMystery = (nicheId?: string): nicheId is typeof ORIGINAL_SERIALIZED_MYSTERY_NICHE_ID =>
  nicheId === ORIGINAL_SERIALIZED_MYSTERY_NICHE_ID;

export const createSerializedStoryState = (
  episodesPerSeries = DEFAULT_SERIALIZED_STORY_EPISODES_PER_SERIES
): SerializedStoryState => ({
  episodesPerSeries,
  nextSeriesNumber: 1,
  nextEpisodeNumber: 1
});

export const cloneSerializedStoryState = (state: SerializedStoryState): SerializedStoryState => {
  const stateDocument = state as SerializedStoryState & { toObject?: () => SerializedStoryState };
  return typeof stateDocument.toObject === "function" ? stateDocument.toObject() : { ...state };
};

export const serializedStoryStarted = (state?: SerializedStoryState): boolean => Boolean(
  state && (
    state.nextSeriesNumber > 1
    || state.nextEpisodeNumber > 1
    || state.seriesTitle
    || state.premise
  )
);

export const buildNextSerializedStoryState = (
  assignment: SerializedStoryAssignment
): SerializedStoryState => {
  if (assignment.episodeNumber >= assignment.episodesPerSeries) {
    return {
      ...createSerializedStoryState(assignment.episodesPerSeries),
      nextSeriesNumber: assignment.seriesNumber + 1
    };
  }

  return {
    episodesPerSeries: assignment.episodesPerSeries,
    nextSeriesNumber: assignment.seriesNumber,
    nextEpisodeNumber: assignment.episodeNumber + 1,
    seriesTitle: assignment.seriesTitle,
    premise: assignment.premise,
    setting: assignment.setting,
    characterNotes: assignment.characterNotes,
    lastEpisodeSummary: assignment.episodeSummary,
    queuedEpisodeTitle: assignment.nextEpisodeTitle,
    queuedEpisodeTopic: assignment.nextEpisodeTopic,
    queuedEpisodePromise: assignment.nextEpisodePromise
  };
};

export const buildSerializedStoryAssignment = (
  candidate: SerializedStoryCandidate,
  state: SerializedStoryState
): SerializedStoryAssignment => ({
  ...candidate,
  seriesNumber: state.nextSeriesNumber,
  episodeNumber: state.nextEpisodeNumber,
  episodesPerSeries: state.episodesPerSeries
});

export const applyQueuedSerializedEpisode = <T extends { title: string; topic: string; serializedStory?: SerializedStoryCandidate }>(
  candidate: T,
  state: SerializedStoryState
): T => {
  if (!state.queuedEpisodeTitle && !state.queuedEpisodeTopic) return candidate;
  if (!candidate.serializedStory) return candidate;

  return {
    ...candidate,
    title: state.queuedEpisodeTitle ?? candidate.title,
    topic: state.queuedEpisodeTopic ?? candidate.topic,
    serializedStory: {
      ...candidate.serializedStory,
      episodeObjective: state.queuedEpisodePromise ?? candidate.serializedStory.episodeObjective
    }
  };
};
