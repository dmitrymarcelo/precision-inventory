-- Supabase/Postgres schema for Precision Inventory.
-- This migration is idempotent because the first Supabase setup may have
-- been started manually before this file was added to the project.

CREATE TABLE IF NOT EXISTS public.app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  matricula TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iters INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  requires_daily_cycle_inventory INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.operation_journal (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  actor_matricula TEXT,
  actor_name TEXT,
  actor_role TEXT,
  operation_type TEXT NOT NULL,
  entity TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS public.request_locks (
  request_id TEXT PRIMARY KEY,
  holder_user_id TEXT NOT NULL,
  holder_matricula TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  holder_role TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_journal_created_at ON public.operation_journal (created_at);
CREATE INDEX IF NOT EXISTS idx_operation_journal_status ON public.operation_journal (status);
CREATE INDEX IF NOT EXISTS idx_request_locks_expires ON public.request_locks (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_users_matricula ON public.users (matricula);

ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_locks ENABLE ROW LEVEL SECURITY;
