# Mailflow — Email Job Scheduler

A full-stack email scheduler built with TypeScript, Express, BullMQ, Redis, PostgreSQL, Elasticsearch, React, and Tailwind CSS. It uses delayed BullMQ jobs only—there are no cron jobs or polling schedulers.

## Start locally

1. Copy `backend/.env.example` to `backend/.env`, then fill in the OAuth, Ethereal, and secret values. PostgreSQL is exposed on host port `5433` to avoid conflicting with an existing local database.
2. Start infrastructure: `docker compose up -d`.
3. Install packages: `npm install`.
4. Run both applications: `npm run dev`.

The dashboard is at `http://localhost:5173`, API at `http://localhost:4000`, and live queue dashboard at `http://localhost:4000/queues`.

### Required environment setup

- **Ethereal:** create an account at [ethereal.email](https://ethereal.email), then set `ETHEREAL_USER` and `ETHEREAL_PASS`. Use one of its SMTP sender addresses in Compose.
- **Google OAuth:** create a Web OAuth client and add `http://localhost:4000/api/auth/google/callback` as an authorized redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and callback URL.
- **Slack:** create a Slack app, add the `chat:write` bot scope, add `http://localhost:4000/api/slack/callback` as a redirect URI, and set the Slack client variables plus `SLACK_ALERT_CHANNEL`. The Connect Slack button completes OAuth and stores the workspace token. A real `chat.postMessage` request is made when the sender limit is reached.

## Architecture

`POST /api/emails/schedule` validates the batch, persists every delivery in PostgreSQL, and places one BullMQ delayed job per database ID. The email ID plus a scheduling suffix gives every queue job a stable idempotency key. PostgreSQL remains the source of truth; Redis persists BullMQ jobs across process restarts. A `queue_enqueued` outbox marker recovers only records committed during a Redis outage, without re-seeding existing jobs.

The worker is configured through `WORKER_CONCURRENCY` (default `5`). It claims an email through an atomic status update before SMTP delivery, so concurrent workers cannot deliver the same row. A deterministic SMTP Message-ID is also used. This deliberately favors avoiding duplicate mail after a crash; messages left in `sending` can be reviewed instead of automatically risking a second delivery.

### Pacing and hourly limit

- `MIN_DELAY_SECONDS` (default `2`) reserves the next per-sender send slot in Redis. Parallel workers therefore keep a provider-style minimum gap.
- `MAX_EMAILS_PER_HOUR_PER_SENDER` (default `200`) is enforced with an atomic Redis Lua script keyed by sender and hour. It is safe across workers and instances.
- A job that cannot obtain an hourly slot is marked `deferred` and re-enqueued for the next hour; it is never dropped. When 1,000+ emails target the same moment, the API performs inexpensive inserts/enqueues while the workers spread delivery according to those two controls.

The design uses no in-memory rate counters, no cron jobs, and no restart “re-seeding,” so a restart does not create duplicate jobs.

Elasticsearch indexes every message as soon as it is scheduled, then receives status updates after delivery. If it is still starting during a local Docker download, scheduling and SMTP delivery remain available and the list endpoint temporarily falls back to a PostgreSQL search; restart the API after Elasticsearch becomes healthy to enable the index.

## Deployment processes

For local development, `npm run dev -w backend` starts both the API and worker. For a managed host, run `npm run start -w backend` with `RUN_WORKER_IN_API=false` for the web API, and run `npm run start:worker -w backend` as a separate private worker service.

## API

- `GET /api/auth/google` / `GET /api/auth/google/callback` — Google login
- `POST /api/auth/logout` — logout
- `GET /api/me` — current profile and Slack connection state
- `GET /api/emails?status=scheduled|sent&q=term` — searchable message list (Elasticsearch)
- `POST /api/emails/schedule` — schedule a validated batch
- `GET /api/slack/connect` / `GET /api/slack/callback` — Slack OAuth
- `DELETE /api/slack/connect` — disconnect Slack

## Features

- PostgreSQL persistence, BullMQ delayed delivery, Ethereal SMTP, and BullMQ operations UI
- Configurable worker concurrency, Redis-backed per-sender pacing, and durable hourly caps
- Elasticsearch document indexing and subject/recipient search
- Google login, profile header, logout, Slack OAuth notifications
- CSV/text lead extraction with detected-count feedback, compose modal, loading/error/empty states, scheduled and sent delivery tables

## Demo checklist

1. Log in, create an Ethereal-backed schedule, and show it in Scheduled Emails.
2. Open the queue dashboard, wait for delivery, then show Sent Emails.
3. Schedule a future message, stop and restart the API, and show it being delivered at its original time.
4. Temporarily lower the hourly limit, schedule several messages from one sender, and show deferred rows plus the Slack notification.

## Trade-offs

The atomic database claim prevents concurrent duplicates. As with every SMTP integration, a process interruption after the SMTP server accepts a message but before the database acknowledgement cannot be perfectly exactly-once without provider-side idempotency. This implementation keeps that message in `sending` rather than retrying and risking a duplicate; it can be inspected and resolved explicitly.
