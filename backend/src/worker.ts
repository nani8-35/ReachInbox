import { db } from "./db/client.js";
import { migrate } from "./db/schema.js";
import { recoverUnqueuedEmails } from "./queue/emailQueue.js";
import { ensureSearchIndex } from "./search/emailSearch.js";
import { startWorker } from "./queue/worker.js";

async function start() {
  await migrate(db);
  await recoverUnqueuedEmails();
  await ensureSearchIndex();
  startWorker();
  console.log("Email worker started");
}
start().catch((error) => { console.error(error); process.exit(1); });
