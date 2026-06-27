-- Journal entries from parents
CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  author TEXT NOT NULL CHECK (author IN ('idan', 'sveta')),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  content TEXT NOT NULL,
  what_worked TEXT,
  what_challenged TEXT,
  what_to_try TEXT,
  raw_telegram_message_id BIGINT
);

-- Conversation history per user for continuity
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  telegram_user_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  mode TEXT CHECK (mode IN ('sos', 'chat', 'morning', 'journal'))
);

-- Morning briefs sent to parents
CREATE TABLE IF NOT EXISTS morning_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  content TEXT NOT NULL,
  sent_to_idan BOOLEAN DEFAULT FALSE,
  sent_to_sveta BOOLEAN DEFAULT FALSE
);

-- Track user states (which mode they're in)
CREATE TABLE IF NOT EXISTS user_states (
  telegram_user_id BIGINT PRIMARY KEY,
  current_mode TEXT CHECK (current_mode IN ('sos', 'chat', 'journal', NULL)),
  journal_step TEXT CHECK (journal_step IN ('what_worked', 'what_challenged', 'what_to_try', 'confirm', NULL)),
  journal_draft JSONB,
  week_start TEXT CHECK (week_start IN ('sunday', 'monday')) DEFAULT 'sunday',
  timezone TEXT DEFAULT 'Asia/Jerusalem',
  onboarded BOOLEAN DEFAULT FALSE,
  display_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook idempotency — prevents Telegram retries from being double-processed
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id BIGINT PRIMARY KEY,
  telegram_user_id BIGINT,
  chat_id BIGINT,
  message_id BIGINT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_updates_status_created_at
ON processed_updates (status, created_at);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(telegram_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_morning_briefs_date ON morning_briefs(date DESC);
