import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { requireUser } from "../auth.js";
import { enqueueEmail } from "../queue/emailQueue.js";
import { indexEmail, searchEmailIds } from "../search/emailSearch.js";

const emailAddress = z.string().trim().email();
const scheduleSchema = z.object({ sender: emailAddress, subject: z.string().trim().min(1).max(255), body: z.string().trim().min(1), recipients: z.array(emailAddress).min(1).max(5_000), startAt: z.string().datetime(), delaySeconds: z.number().int().min(0).max(86_400), hourlyLimit: z.number().int().min(1).max(100_000) });
export const emailRouter = Router();
emailRouter.use(requireUser);

emailRouter.post("/schedule", async (req, res, next) => { try {
  const input = scheduleSchema.parse(req.body); const startAt = new Date(input.startAt); if (startAt.getTime() < Date.now() - 1000) return res.status(400).json({ error: "Start time must be in the future" });
  const recipients = [...new Set(input.recipients.map((item) => item.toLowerCase()))]; const client = await db.connect();
  try { await client.query("BEGIN"); const ids: Array<{ id: string; scheduled_at: Date }> = [];
    for (const [position, recipient] of recipients.entries()) { const scheduledAt = new Date(startAt.getTime() + position * input.delaySeconds * 1000); const result = await client.query<{ id: string; scheduled_at: Date }>("INSERT INTO email_messages (user_id,recipient,sender,subject,body,scheduled_at,hourly_limit) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,scheduled_at", [req.user!.id, recipient, input.sender, input.subject, input.body, scheduledAt, input.hourlyLimit]); ids.push(result.rows[0]); }
    await client.query("COMMIT"); await Promise.all(ids.map(async (row) => { await enqueueEmail(row.id, row.scheduled_at); await db.query("UPDATE email_messages SET queue_enqueued = true, updated_at = now() WHERE id = $1", [row.id]); }));
    res.status(201).json({ scheduled: ids.length });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
} catch (error) { next(error); } });

emailRouter.get("", async (req, res, next) => { try {
  const status = String(req.query.status ?? "scheduled"); if (!["scheduled", "sent"].includes(status)) return res.status(400).json({ error: "status must be scheduled or sent" });
  const query = String(req.query.q ?? "").trim(); let filter = "status IN ('scheduled','deferred','sending')"; if (status === "sent") filter = "status IN ('sent','failed')";
  let sql = `SELECT id,recipient,sender,subject,scheduled_at,sent_at,status,error_message FROM email_messages WHERE user_id = $1 AND ${filter}`; let params: unknown[] = [req.user!.id];
  if (query) { const ids = await searchEmailIds(req.user!.id, query); if (ids) { if (!ids.length) return res.json({ emails: [] }); sql += " AND id = ANY($2::uuid[])"; params.push(ids); } else { sql += " AND (recipient ILIKE $2 OR subject ILIKE $2)"; params.push(`%${query}%`); } }
  sql += " ORDER BY COALESCE(sent_at, scheduled_at) DESC LIMIT 200"; const { rows } = await db.query(sql, params); res.json({ emails: rows.map(toApiEmail) });
} catch (error) { next(error); } });
function toApiEmail(row: any) { return { id: row.id, recipient: row.recipient, sender: row.sender, subject: row.subject, scheduledAt: row.scheduled_at, sentAt: row.sent_at, status: row.status, error: row.error_message }; }

emailRouter.post("/reindex", async (req, res, next) => { try { const { rows } = await db.query("SELECT * FROM email_messages WHERE user_id = $1", [req.user!.id]); await Promise.all(rows.map(indexEmail)); res.json({ indexed: rows.length }); } catch (error) { next(error); } });
