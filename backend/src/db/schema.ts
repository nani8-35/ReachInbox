import { Pool } from "pg";

export async function migrate(db: Pool) {
  await db.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), google_id text UNIQUE NOT NULL,
      email text UNIQUE NOT NULL, name text NOT NULL, avatar_url text, slack_access_token text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS email_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient text NOT NULL, sender text NOT NULL, subject text NOT NULL, body text NOT NULL,
      scheduled_at timestamptz NOT NULL, sent_at timestamptz, status text NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','deferred','sending','sent','failed')),
      error_message text, provider_message_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS queue_enqueued boolean NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS email_messages_user_status_scheduled_idx ON email_messages(user_id, status, scheduled_at);
    CREATE INDEX IF NOT EXISTS email_messages_sender_idx ON email_messages(sender);
  `);
}
