import { Router } from "express";
import { requireUser } from "../auth.js";
import { db } from "../db/client.js";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const slackRouter = Router();
slackRouter.get("/connect", requireUser, (req, res) => { const state = jwt.sign({ userId: req.user!.id, purpose: "slack-connect" }, config.jwtSecret, { expiresIn: "10m" }); const params = new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID ?? "", redirect_uri: process.env.SLACK_CALLBACK_URL ?? "", scope: "chat:write", state }); res.redirect(`https://slack.com/oauth/v2/authorize?${params}`); });
slackRouter.get("/callback", async (req, res, next) => { try { const state = jwt.verify(String(req.query.state ?? ""), config.jwtSecret) as { userId: string; purpose: string }; if (state.purpose !== "slack-connect") throw new Error("Invalid Slack authorization state"); const response = await fetch("https://slack.com/api/oauth.v2.access", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: String(req.query.code ?? ""), client_id: process.env.SLACK_CLIENT_ID ?? "", client_secret: process.env.SLACK_CLIENT_SECRET ?? "", redirect_uri: process.env.SLACK_CALLBACK_URL ?? "" }) }); const payload = await response.json() as { ok: boolean; access_token?: string; error?: string }; if (!payload.ok || !payload.access_token) throw new Error(payload.error ?? "Slack authorization failed"); await db.query("UPDATE users SET slack_access_token = $1, updated_at = now() WHERE id = $2", [payload.access_token, state.userId]); res.redirect(`${process.env.FRONTEND_URL ?? "http://localhost:5173"}?slack=connected`); } catch (error) { next(error); } });
slackRouter.delete("/connect", requireUser, async (req, res, next) => { try { await db.query("UPDATE users SET slack_access_token = NULL WHERE id = $1", [req.user!.id]); res.status(204).end(); } catch (error) { next(error); } });
