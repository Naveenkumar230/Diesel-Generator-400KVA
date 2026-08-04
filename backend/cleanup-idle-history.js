'use strict';
require('dotenv').config();
const { MongoClient } = require('mongodb');

// Must match HISTORY_RPM_THRESHOLD in server.js
const RPM_THRESHOLD = 100;
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = await MongoClient.connect(process.env.MONGO_URI, {
    tls: true,
    serverSelectionTimeoutMS: 10000,
  });
  const db  = client.db(process.env.MONGO_DB || 'gensight');
  const col = db.collection('history');

  const totalBefore = await col.countDocuments();

  // Catches: RPM <= threshold, OR RPM missing/null (old docs before this field existed)
  const filter = {
    $or: [
      { engineRPM: { $lte: RPM_THRESHOLD } },
      { engineRPM: { $exists: false } }
    ]
  };

  const idleCount = await col.countDocuments(filter);

  console.log(`Total documents in 'history':            ${totalBefore}`);
  console.log(`Idle/noise docs (engineRPM <= ${RPM_THRESHOLD}):     ${idleCount}`);
  console.log(`Docs that will remain (engine running):  ${totalBefore - idleCount}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No documents deleted.');
    console.log('Run again WITHOUT --dry-run to actually delete these documents.');
    await client.close();
    return;
  }

  console.log('\nDeleting idle documents...');
  const result = await col.deleteMany(filter);
  console.log(`Deleted ${result.deletedCount} documents.`);

  const totalAfter = await col.countDocuments();
  console.log(`Documents remaining in 'history': ${totalAfter}`);

  console.log('\nNote: Atlas storage % may take a few minutes to reflect the change');
  console.log('after deletion (background compaction).');

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });