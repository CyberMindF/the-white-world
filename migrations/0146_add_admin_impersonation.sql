ALTER TABLE sessions ADD COLUMN impersonated_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN impersonation_active INTEGER NOT NULL DEFAULT 0 CHECK (impersonation_active IN (0,1));
