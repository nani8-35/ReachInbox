import { Queue } from "bullmq";
import { redis } from "./connection.js";
import { db } from "../db/client.js";

export const EMAIL_QUEUE = "email-delivery";
export type EmailJob = { emailId: string };
export const emailQueue = new Queue<EmailJob>(EMAIL_QUEUE, { connection: redis, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: 500, removeOnFail: 500 } });

export async function enqueueEmail(emailId: string, sendAt: Date, suffix = "initial") {
  const delay = Math.max(0, sendAt.getTime() - Date.now());
  await emailQueue.add("deliver-email", { emailId }, { jobId: `${emailId}-${suffix}`, delay });
}

/** Reconciles only rows that were committed before a temporary Redis failure. */
export async function recoverUnqueuedEmails() {
  const { rows } = await db.query<{ id: string; scheduled_at: Date }>("SELECT id, scheduled_at FROM email_messages WHERE queue_enqueued = false AND status IN ('scheduled', 'deferred') ORDER BY scheduled_at ASC");
  for (const row of rows) {
    await enqueueEmail(row.id, row.scheduled_at);
    await db.query("UPDATE email_messages SET queue_enqueued = true, updated_at = now() WHERE id = $1", [row.id]);
  }
  if (rows.length) console.info(`Recovered ${rows.length} unqueued email record(s).`);
}
