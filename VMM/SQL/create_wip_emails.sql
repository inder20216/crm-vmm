-- Run this in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS wip_emails (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email_id        TEXT        NOT NULL UNIQUE,
  conversation_id TEXT,
  subject         TEXT,
  from_addr       TEXT,
  store_code      TEXT,
  received_at     TEXT,
  replied_at      TEXT,
  partial_fields  JSONB       DEFAULT '{}',
  saved_by        TEXT,
  status          TEXT        DEFAULT 'open',
  created_at      TIMESTAMPTZ DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wip_status ON wip_emails (status);
CREATE INDEX IF NOT EXISTS idx_wip_conv   ON wip_emails (conversation_id);
