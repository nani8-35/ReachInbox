import { Worker } from "bullmq";
import nodemailer from "nodemailer";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { indexEmail } from "../search/emailSearch.js";
import { reserveHourlySlot, reserveSenderGap } from "../rateLimiter/hourlyLimiter.js";
import { EMAIL_QUEUE, emailQueue, type EmailJob, enqueueEmail } from "./emailQueue.js";
import { redis } from "./connection.js";

const transport = nodemailer.createTransport({ host: "smtp.ethereal.email", port: 587, secure: false, auth: { user: process.env.ETHEREAL_USER, pass: process.env.ETHEREAL_PASS } });

async function notifyRateLimit(userId: string, sender: string) {
  const { rows } = await db.query<{ slack_access_token: string | null }>("SELECT slack_access_token FROM users WHERE id = $1", [userId]);
  const token = rows[0]?.slack_access_token ?? process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_ALERT_CHANNEL;
  if (!token || !channel) return;
  await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ channel, text: `Hourly sending limit reached for ${sender}. Remaining emails were deferred to the next hour.` }) });
}

export const worker = new Worker<EmailJob>(EMAIL_QUEUE, async (job) => {
  const { rows } = await db.query<any>("SELECT * FROM email_messages WHERE id = $1", [job.data.emailId]);
  const email = rows[0];
  if (!email || email.status === "sent" || email.status === "failed" || email.status === "sending") return;

  const rate = await reserveHourlySlot(email.sender, email.hourly_limit ?? config.maxPerHour);
  if (!rate.allowed) {
    await db.query("UPDATE email_messages SET status = 'deferred', scheduled_at = to_timestamp($2 / 1000.0), updated_at = now() WHERE id = $1 AND status <> 'sent'", [email.id, rate.retryAt]);
    await enqueueEmail(email.id, new Date(rate.retryAt), `rate-${rate.retryAt}`);
    await notifyRateLimit(email.user_id, email.sender);
    return;
  }

  const gapAt = await reserveSenderGap(email.sender, config.minDelayMs);
  if (gapAt > Date.now() + 50) {
    await db.query("UPDATE email_messages SET status = 'deferred', scheduled_at = to_timestamp($2 / 1000.0), updated_at = now() WHERE id = $1 AND status <> 'sent'", [email.id, gapAt]);
    await enqueueEmail(email.id, new Date(gapAt), `gap-${gapAt}`);
    return;
  }

  const claimed = await db.query<any>("UPDATE email_messages SET status = 'sending', updated_at = now() WHERE id = $1 AND status IN ('scheduled','deferred') RETURNING *", [email.id]);
  if (!claimed.rowCount) return;
  try {
    const sent = await transport.sendMail({ from: email.sender, to: email.recipient, subject: email.subject, text: email.body, messageId: `<${email.id}@scheduler.local>` });
    const updated = await db.query<any>("UPDATE email_messages SET status = 'sent', sent_at = now(), provider_message_id = $2, updated_at = now() WHERE id = $1 RETURNING *", [email.id, sent.messageId]);
    await indexEmail(updated.rows[0]);
  } catch (error) {
    const updated = await db.query<any>("UPDATE email_messages SET status = 'failed', error_message = $2, updated_at = now() WHERE id = $1 RETURNING *", [email.id, error instanceof Error ? error.message : "SMTP delivery failed"]);
    await indexEmail(updated.rows[0]);
    throw error;
  }
}, { connection: redis, concurrency: config.workerConcurrency });

worker.on("failed", (job, error) => console.error(`Email job ${job?.id} failed:`, error.message));
