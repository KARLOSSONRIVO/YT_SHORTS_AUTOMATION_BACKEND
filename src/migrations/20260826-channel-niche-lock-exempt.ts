import { env } from "../config/env";
import { connectToDatabase, disconnectFromDatabase } from "../infrastructure/db/mongoose";
import { ChannelModel } from "../modules/models/channel.model";

const run = async () => {
  await connectToDatabase(env.MONGODB_URI);
  const result = await ChannelModel.updateMany({}, { $set: { nicheLockExempt: true } }).exec();
  console.log(`Grandfathered ${result.modifiedCount} existing channel(s) as niche-lock exempt.`);
  await disconnectFromDatabase();
};

void run().catch(async (error) => {
  console.error(error);
  await disconnectFromDatabase().catch(() => undefined);
  process.exitCode = 1;
});
