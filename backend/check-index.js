require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main() {
  const client = await MongoClient.connect(process.env.MONGO_URI, {
    tls: true,
    serverSelectionTimeoutMS: 10000,
  });
  const db = client.db(process.env.MONGO_DB || 'gensight');

  const indexes = await db.collection('history').indexes();
  console.log('Indexes on "history":');
  console.log(indexes);

  const count = await db.collection('history').countDocuments();
  console.log('Total documents in "history":', count);

  await client.close();
}

main().catch(console.error);