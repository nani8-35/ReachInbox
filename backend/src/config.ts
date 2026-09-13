import "dotenv/config";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function positive(name: string, fallback: number) { const value = Number(process.env[name] ?? fallback); if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`); return value; }
export const config = {
  port: positive("PORT", 4000), frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  databaseUrl: required("DATABASE_URL"), redisUrl: required("REDIS_URL"),
  elasticsearchUrl: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
  jwtSecret: required("JWT_SECRET"), workerConcurrency: positive("WORKER_CONCURRENCY", 5),
  minDelayMs: positive("MIN_DELAY_SECONDS", 2) * 1000,
  maxPerHour: positive("MAX_EMAILS_PER_HOUR_PER_SENDER", 200),
};
