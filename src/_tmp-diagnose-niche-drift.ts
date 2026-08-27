// TEMPORARY read-only diagnostic — deleted after we finish debugging.
// No writes: only listCollections / find / distinct / countDocuments.
import mongoose from "mongoose";
import { env } from "./config/env";
import { connectToDatabase, disconnectFromDatabase } from "./infrastructure/db/mongoose";

const run = async () => {
  await connectToDatabase(env.MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is unavailable.");

  console.log("DB NAME:", db.databaseName);

  const cols = (await db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name));
  console.log("\n=== COLLECTIONS (name : count) ===");
  for (const c of cols) console.log(`  ${c.name} : ${await db.collection(c.name).countDocuments()}`);

  console.log("\n=== NICHE-LIKE DOCS (any collection whose docs have profileId or slug) ===");
  for (const c of cols) {
    const sample = await db.collection(c.name).findOne({ $or: [{ profileId: { $exists: true } }, { slug: { $exists: true } }] });
    if (!sample) continue;
    const docs = await db.collection(c.name).find({}, { projection: { profileId: 1, slug: 1, name: 1, active: 1 } }).limit(100).toArray();
    console.log(`  [${c.name}] ${docs.length} doc(s):`);
    for (const d of docs) console.log(`     profileId=${JSON.stringify(d.profileId)} slug=${JSON.stringify(d.slug)} name=${JSON.stringify(d.name)} active=${d.active}`);
  }

  const channels = db.collection("channels");
  console.log("\n=== CHANNELS (all) ===");
  for (const c of await channels.find({}).toArray()) {
    const created = c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt);
    console.log(`  _id=${c._id} title=${JSON.stringify(c.title)} externalChannelId=${JSON.stringify(c.externalChannelId)} nicheId=${JSON.stringify(c.nicheId)} nicheLockExempt=${JSON.stringify(c.nicheLockExempt)} status=${JSON.stringify(c.status)} createdAt=${created}`);
  }

  const projects = db.collection("projects");
  console.log("\n=== PROJECTS (all) ===");
  for (const p of await projects.find({}, { projection: { title: 1, accountId: 1, nicheId: 1, contentType: 1, projectType: 1 } }).toArray()) {
    console.log(`  _id=${p._id} title=${JSON.stringify(p.title)} accountId=${JSON.stringify(p.accountId)} nicheId=${JSON.stringify(p.nicheId)} contentType=${JSON.stringify(p.contentType)} projectType=${JSON.stringify(p.projectType)}`);
  }

  console.log("\n=== DISTINCT channel.nicheId ===", JSON.stringify(await channels.distinct("nicheId")));
  console.log("=== DISTINCT project.nicheId ===", JSON.stringify(await projects.distinct("nicheId")));

  await disconnectFromDatabase();
};

void run().catch(async (error) => {
  console.error(error);
  await disconnectFromDatabase().catch(() => undefined);
  process.exitCode = 1;
});
