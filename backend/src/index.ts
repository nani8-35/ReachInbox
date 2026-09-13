import express from "express";
import cors from "cors";
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { migrate } from "./db/schema.js";
import { ensureSearchIndex } from "./search/emailSearch.js";
import { emailQueue, recoverUnqueuedEmails } from "./queue/emailQueue.js";
import { startWorker } from "./queue/worker.js";
import { authRouter, requireUser } from "./auth.js";
import { emailRouter } from "./api/emails.js";
import { slackRouter } from "./api/slack.js";
import { ZodError } from "zod";

async function start() { await migrate(db); await recoverUnqueuedEmails(); await ensureSearchIndex(); if (process.env.RUN_WORKER_IN_API !== "false") startWorker(); const app = express(); app.use(cors({ origin: config.frontendUrl, credentials: true })); app.use(express.json({ limit: "2mb" }));
  app.get("/health", (_req, res) => res.json({ ok: true })); app.use("/api/auth", authRouter); app.use("/api/emails", emailRouter); app.use("/api/slack", slackRouter); app.get("/api/me", requireUser, async (req, res) => { const row = await db.query<{ slack_access_token: string | null }>("SELECT slack_access_token FROM users WHERE id = $1", [req.user!.id]); res.json({ user: req.user, slackConnected: Boolean(row.rows[0]?.slack_access_token) }); });
  const adapter = new ExpressAdapter(); adapter.setBasePath("/queues"); createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter: adapter }); app.use("/queues", adapter.getRouter());
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(error); if (error instanceof ZodError) return res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request" }); res.status(500).json({ error: error instanceof Error ? error.message : "Something went wrong" }); });
  app.listen(config.port, () => console.log(`Scheduler API listening on :${config.port}`)); }
start().catch((error) => { console.error(error); process.exit(1); });
