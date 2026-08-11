import { z } from 'zod';
import { AUTOMATION_MODES, CONTENT_TYPES, STORY_FORMATS, VISUAL_TYPES } from '../automation/automation.types';

export const projectIdParamsSchema = z.object({ projectId: z.string().min(1) });
export const projectAccountParamsSchema = z.object({ accountId: z.string().min(1) });
export const projectStoryParamsSchema = z.object({ projectId: z.string().min(1), storyId: z.string().min(1) });
export const nicheParamsSchema = z.object({ nicheId: z.string().min(1) });
export const clipParamsSchema = z.object({ projectId: z.string().min(1), clipId: z.string().min(1) });
export const redditSourceParamsSchema = z.object({ projectId: z.string().min(1), sourceId: z.string().min(1) });
export const subredditBodySchema = z.object({ subreddit: z.string().trim().regex(/^[A-Za-z0-9_]{2,30}$/) });
export const redditRejectBodySchema = z.object({ reason: z.string().trim().min(2).max(500) });
export const nicheActiveBodySchema = z.object({ active: z.boolean() });

export const redditConfigSchema = z.object({
  sourceMode: z.enum(['ONE_SUBREDDIT', 'MULTIPLE_SUBREDDITS', 'AUTO']).default('AUTO'),
  subreddits: z.array(z.string().trim().regex(/^[A-Za-z0-9_]{2,30}$/)).max(20).default([]),
  sortMethod: z.enum(['NEW', 'HOT', 'TOP_TODAY', 'TOP_WEEK', 'RISING', 'BEST_ELIGIBLE']).default('BEST_ELIGIBLE'),
  minimumScore: z.coerce.number().int().min(0).default(50),
  minimumComments: z.coerce.number().int().min(0).default(10),
  minimumBodyLength: z.coerce.number().int().min(80).max(20000).default(300),
  allowNSFW: z.boolean().default(false), includeComments: z.boolean().default(false),
  excludeLocked: z.boolean().default(true), contentFilters: z.array(z.string()).default([]),
  attributionMode: z.enum(['link', 'subreddit', 'none']).default('link'),
  allowCrossAccountReuse: z.boolean().default(false)
});

const projectFields = z.object({
  name: z.string().trim().min(2).max(120),
  contentType: z.enum(CONTENT_TYPES).default('FACELESS_NICHE'),
  nicheId: z.string().regex(/^[a-z0-9_]+$/).optional(),
  accountId: z.string().min(1), language: z.string().trim().min(2).max(12),
  uploadTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().trim().min(3).max(80),
  visualType: z.enum(VISUAL_TYPES).default('AUTO'),
  automationMode: z.enum(AUTOMATION_MODES).default('approval_before_upload'),
  automationEnabled: z.boolean().default(false),
  allowedNarrativeFormats: z.array(z.enum(STORY_FORMATS)).max(STORY_FORMATS.length).optional(),
  redditConfig: redditConfigSchema.optional()
});

const validateProject = (value: z.infer<typeof projectFields>, context: z.RefinementCtx) => {
  if (value.contentType === 'FACELESS_NICHE' && !value.nicheId)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['nicheId'], message: 'Select an active niche profile.' });
  if (value.contentType === 'REDDIT_STORY') {
    if (!value.redditConfig) context.addIssue({ code: z.ZodIssueCode.custom, path: ['redditConfig'], message: 'Reddit source settings are required.' });
    else if (value.redditConfig.sourceMode !== 'AUTO' && !value.redditConfig.subreddits.length)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['redditConfig', 'subreddits'], message: 'Select at least one subreddit.' });
  }
};

export const createProjectBodySchema = projectFields.superRefine(validateProject);
export const updateProjectBodySchema = projectFields.partial();

export const reorderClipsBodySchema = z.object({ clipIds: z.array(z.string().min(1)).min(1).max(100) });
export const scheduleClipBodySchema = z.object({ scheduledAt: z.coerce.date() });
export const clipUploadBodySchema = z.object({
  title: z.string().trim().min(2).max(100), description: z.string().max(5000).optional(),
  hashtags: z.string().max(500).optional(), language: z.string().min(2).max(12).default('en'),
  scheduledAt: z.coerce.date().optional(), privacyStatus: z.enum(['private', 'public', 'unlisted']).default('private'),
  audienceSetting: z.enum(['not_made_for_kids', 'made_for_kids']).default('not_made_for_kids')
});
