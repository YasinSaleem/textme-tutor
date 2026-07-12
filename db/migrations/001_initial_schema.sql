-- Drop old Phase 1 tables if they exist
DROP TABLE IF EXISTS lesson_deliveries CASCADE;
DROP TABLE IF EXISTS lessons CASCADE;
DROP TABLE IF EXISTS learning_patterns CASCADE;
DROP TABLE IF EXISTS generation_runs CASCADE;
DROP TABLE IF EXISTS problems CASCADE;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS user_lessons (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  
  leetcode_id INTEGER NOT NULL,
  problem_title TEXT NOT NULL,
  normalized_problem_title TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  
  lesson_markdown TEXT NOT NULL,
  lesson_version INTEGER NOT NULL DEFAULT 1 CHECK (lesson_version >= 1),
  teaching_score NUMERIC(4,2) CHECK (teaching_score >= 0 AND teaching_score <= 10),
  
  status TEXT NOT NULL CHECK (status IN ('pending', 'understood', 'vague')),
  
  slack_channel_id TEXT NOT NULL,
  slack_message_ts TEXT NOT NULL UNIQUE,
  
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_lessons_user_status_sent_at_idx
  ON user_lessons (user_id, status, sent_at);

DROP TRIGGER IF EXISTS user_lessons_set_updated_at ON user_lessons;

CREATE TRIGGER user_lessons_set_updated_at
BEFORE UPDATE ON user_lessons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
