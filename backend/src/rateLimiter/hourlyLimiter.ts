import { redis } from "../queue/connection.js";

const reserveScript = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return 0 end
current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIREAT', KEYS[1], ARGV[2]) end
return 1`;
export function nextHour(now = Date.now()) { const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d.getTime(); }
export async function reserveHourlySlot(sender: string, limit: number) {
  const resetAt = nextHour(); const hour = Math.floor(Date.now() / 3_600_000);
  const allowed = await redis.eval(reserveScript, 1, `email-rate:${sender}:${hour}`, limit, resetAt);
  return { allowed: allowed === 1, retryAt: resetAt };
}
export async function reserveSenderGap(sender: string, minDelayMs: number) {
  const key = `email-next-send:${sender}`; const now = Date.now();
  const scheduledAt = await redis.eval(`local next=tonumber(redis.call('GET',KEYS[1]) or '0'); local now=tonumber(ARGV[1]); local gap=tonumber(ARGV[2]); local allowed=math.max(now,next); redis.call('SET',KEYS[1],allowed+gap,'PX',gap*2); return allowed`, 1, key, now, minDelayMs) as number;
  return Number(scheduledAt);
}
