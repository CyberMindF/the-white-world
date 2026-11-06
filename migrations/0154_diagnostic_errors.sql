-- Separato dalla telemetria di attività; identità reali ed effettive distinte.
CREATE TABLE diagnostic_errors (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('browser','server')),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  actor_user_id INTEGER,
  effective_user_id INTEGER,
  session_id INTEGER,
  request_id TEXT,
  path TEXT NOT NULL,
  user_agent TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  rate_key TEXT NOT NULL
);
CREATE INDEX diagnostic_errors_received ON diagnostic_errors(received_at DESC);
CREATE INDEX diagnostic_errors_actor ON diagnostic_errors(actor_user_id, received_at DESC);
CREATE INDEX diagnostic_errors_rate ON diagnostic_errors(rate_key, received_at);
