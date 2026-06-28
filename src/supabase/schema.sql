-- =================================================================================
-- PARENTS ASSISTANT - MULTI-TENANT B2C SCHEMA
-- =================================================================================

-- 1. Families Table (The Core Multi-Tenant entity)
CREATE TABLE IF NOT EXISTS families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code TEXT UNIQUE,
  subscription_status TEXT DEFAULT 'trialing' CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Children Table (Supports multiple children per family)
CREATE TABLE IF NOT EXISTS children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age NUMERIC,
  profile_tags JSONB DEFAULT '[]'::jsonb, -- e.g., ["Sensory_Seeking", "RSD", "ADHD_Combined"]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. User States (Telegram Accounts linked to Families)
CREATE TABLE IF NOT EXISTS user_states (
  telegram_user_id BIGINT PRIMARY KEY,
  family_id UUID REFERENCES families(id) ON DELETE CASCADE,
  current_mode TEXT CHECK (current_mode IN ('sos', 'chat', 'journal', NULL)),
  journal_step TEXT CHECK (journal_step IN ('what_worked', 'what_challenged', 'what_to_try', 'confirm', NULL)),
  journal_draft JSONB,
  week_start TEXT CHECK (week_start IN ('sunday', 'monday')) DEFAULT 'sunday',
  timezone TEXT DEFAULT 'Asia/Jerusalem',
  onboarded BOOLEAN DEFAULT FALSE,
  display_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Journal Entries (Manual entries from evening reflection)
CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL REFERENCES user_states(telegram_user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  content TEXT NOT NULL,
  what_worked TEXT,
  what_challenged TEXT,
  what_to_try TEXT,
  raw_telegram_message_id BIGINT
);

-- 5. Level 1 Memory: Journal Events (ABC Model Extraction)
CREATE TABLE IF NOT EXISTS journal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  telegram_user_id BIGINT REFERENCES user_states(telegram_user_id) ON DELETE SET NULL,
  raw_text TEXT,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  situation TEXT,
  antecedent TEXT,
  behavior TEXT,
  parent_response TEXT,
  outcome TEXT,
  intensity TEXT CHECK (intensity IN ('low', 'medium', 'high')),
  possible_triggers JSONB DEFAULT '[]'::jsonb,
  strategies_used JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Level 2 Memory: Processed Patterns & Knowledge
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id UUID REFERENCES children(id) ON DELETE CASCADE,
  telegram_user_id BIGINT REFERENCES user_states(telegram_user_id) ON DELETE SET NULL, -- who confirmed it
  memory_type TEXT NOT NULL CHECK (memory_type IN ('child_profile', 'trigger_pattern', 'effective_strategy', 'family_context', 'upcoming_context', 'parent_response_pattern')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  context_tags JSONB DEFAULT '[]'::jsonb,
  recurrence_rule TEXT,
  confidence_score NUMERIC DEFAULT 1, -- 1=low, 2=medium, 3=high
  evidence_count INT DEFAULT 1,
  source_entry_ids UUID[] DEFAULT '{}', -- References journal_events
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'possible', 'needs_verification', 'deprecated')),
  expires_at TIMESTAMPTZ,
  contradicted_by_memory_id UUID REFERENCES memories(id)
);

-- 7. Morning Briefs
CREATE TABLE IF NOT EXISTS morning_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  content TEXT NOT NULL,
  sent_to_telegram_ids BIGINT[] DEFAULT '{}' -- track which parents received it
);

-- 8. Conversation History
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL REFERENCES user_states(telegram_user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  mode TEXT CHECK (mode IN ('sos', 'chat', 'morning', 'journal'))
);

-- 9. Job Queue
CREATE TABLE IF NOT EXISTS telegram_jobs (
  id BIGSERIAL PRIMARY KEY,
  update_id BIGINT UNIQUE NOT NULL,
  telegram_user_id BIGINT,
  chat_id BIGINT NOT NULL,
  message_id BIGINT,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'scheduled')),
  attempts INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Webhook Idempotency
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

-- =================================================================================
-- INDEXES
-- =================================================================================
CREATE INDEX IF NOT EXISTS idx_journal_entries_family_date ON journal_entries(family_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_events_family ON journal_events(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_family ON memories(family_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(telegram_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_morning_briefs_family_date ON morning_briefs(family_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_processed_updates_status_created_at ON processed_updates (status, created_at);
CREATE INDEX IF NOT EXISTS idx_telegram_jobs_status_priority_created_at ON telegram_jobs (status, priority, created_at);

-- =================================================================================
-- ROW LEVEL SECURITY (RLS)
-- =================================================================================
-- Note: In a real Supabase setup, you would enable RLS and add policies using the auth.uid()
-- mapping to telegram_user_id via a secure JWT or edge function.
-- For server-to-server (Vercel to Supabase via Service Role Key), RLS is bypassed.
