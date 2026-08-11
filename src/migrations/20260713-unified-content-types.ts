import { env } from '../config/env';
import { connectToDatabase, disconnectFromDatabase } from '../infrastructure/db/mongoose';
import { NicheConfigService } from '../modules/automation/niche-config.service';
import { NicheProfileModel } from '../modules/models/niche-profile.model';
import { ProjectModel } from '../modules/models/project.model';
import { QueuedClipModel } from '../modules/models/queued-clip.model';
import { RedditProjectConfigModel } from '../modules/models/reddit-project-config.model';
import { RedditSourceModel } from '../modules/models/reddit-source.model';
import { UploadHistoryModel } from '../modules/models/upload-history.model';

const run = async () => {
  await connectToDatabase(env.MONGODB_URI);
  await new NicheConfigService().seedDefaults();
  await ProjectModel.updateMany({ contentType: { $exists: false }, projectType: 'uploaded_video' }, { $set: { contentType: 'CLIP_UPLOAD', visualType: 'AUTO' } });
  await ProjectModel.updateMany({ contentType: { $exists: false }, $or: [{ legacySource: 'reddit_trending' }, { facelessSource: 'reddit_trending' }] },
    { $set: { contentType: 'REDDIT_STORY', visualType: 'AUTO' } });
  await ProjectModel.updateMany({ contentType: { $exists: false }, projectType: 'faceless_story' }, { $set: { contentType: 'FACELESS_NICHE', visualType: 'AUTO' } });
  await Promise.all([
    NicheProfileModel.syncIndexes(), ProjectModel.syncIndexes(), RedditProjectConfigModel.syncIndexes(),
    RedditSourceModel.syncIndexes(), QueuedClipModel.syncIndexes(), UploadHistoryModel.syncIndexes()
  ]);
  await disconnectFromDatabase();
};

void run().catch(async (error) => {
  console.error(error); await disconnectFromDatabase().catch(() => undefined); process.exitCode = 1;
});
