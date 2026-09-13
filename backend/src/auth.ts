import { Router, type RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { db } from "./db/client.js";
import { config } from "./config.js";

export type SessionUser = { id: string; email: string; name: string; avatarUrl: string | null };
declare global { namespace Express { interface Request { user?: SessionUser } } }
const cookieName = "scheduler_session";
const cookieAttributes = `Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
function readCookie(req: Parameters<RequestHandler>[0]) { return req.headers.cookie?.split("; ").find((part) => part.startsWith(`${cookieName}=`))?.split("=")[1]; }
export const requireUser: RequestHandler = (req, res, next) => { try { const token = readCookie(req); if (!token) throw new Error(); req.user = jwt.verify(token, config.jwtSecret) as SessionUser; next(); } catch { res.status(401).json({ error: "Authentication required" }); } };
function redirectGoogle() { const state = jwt.sign({ purpose: "google-oauth" }, config.jwtSecret, { expiresIn: "10m" }); const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: process.env.GOOGLE_CALLBACK_URL ?? "", response_type: "code", scope: "openid email profile", access_type: "offline", prompt: "select_account", state }); return `https://accounts.google.com/o/oauth2/v2/auth?${params}`; }
export const authRouter = Router();
authRouter.get("/google", (_req, res) => res.redirect(redirectGoogle()));
authRouter.get("/google/callback", async (req, res, next) => { try {
  const state = jwt.verify(String(req.query.state ?? ""), config.jwtSecret) as { purpose: string }; if (state.purpose !== "google-oauth") throw new Error("Invalid Google authorization state");
  const code = String(req.query.code ?? ""); if (!code) throw new Error("Google did not return an authorization code");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: process.env.GOOGLE_CALLBACK_URL ?? "", grant_type: "authorization_code" }) });
  const token = await tokenResponse.json() as { access_token?: string }; if (!token.access_token) throw new Error("Google token exchange failed");
  const profile = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } })).json() as { sub: string; email: string; name: string; picture?: string };
  const { rows } = await db.query<any>(`INSERT INTO users (google_id,email,name,avatar_url) VALUES ($1,$2,$3,$4) ON CONFLICT (google_id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,avatar_url=EXCLUDED.avatar_url,updated_at=now() RETURNING id,email,name,avatar_url`, [profile.sub, profile.email, profile.name, profile.picture ?? null]);
  const user = { id: rows[0].id, email: rows[0].email, name: rows[0].name, avatarUrl: rows[0].avatar_url };
  res.setHeader("Set-Cookie", `${cookieName}=${jwt.sign(user, config.jwtSecret, { expiresIn: "7d" })}; ${cookieAttributes}`); res.redirect(config.frontendUrl);
} catch (error) { next(error); } });
authRouter.post("/logout", (_req, res) => { res.setHeader("Set-Cookie", `${cookieName}=; ${cookieAttributes}; Max-Age=0`); res.status(204).end(); });
