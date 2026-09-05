-- VP Overwatch — dashboard/alerts durable schema.
-- Idempotent: safe to run repeatedly (CREATE ... IF NOT EXISTS).
-- Telemetry columns are NULLABLE on purpose: NULL = unknown, never a false 0.

-- ── Tracked roster + verified hex mappings ──────────────────────────────────
CREATE TABLE IF NOT EXISTS tracked_aircraft (
  registration     TEXT PRIMARY KEY,
  description      TEXT NOT NULL DEFAULT '',
  type_label       TEXT NOT NULL DEFAULT 'aircraft',
  icao24           TEXT,                         -- verified hex, NULL until resolved
  mapping_source   TEXT NOT NULL DEFAULT 'adsb_exchange',
  mapping_status   TEXT NOT NULL DEFAULT 'unresolved'
                     CHECK (mapping_status IN ('verified','unresolved')),
  resolved_at      TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  active           BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── Normalized current state (source of truth for the read API) ─────────────
CREATE TABLE IF NOT EXISTS aircraft_current_state (
  registration            TEXT PRIMARY KEY REFERENCES tracked_aircraft(registration) ON DELETE CASCADE,
  icao24                  TEXT,
  mapping_status          TEXT NOT NULL DEFAULT 'unresolved',
  state                   TEXT NOT NULL DEFAULT 'unresolved'
                            CHECK (state IN ('unresolved','live_airborne','live_ground','stale','unavailable')),
  data_status             TEXT NOT NULL DEFAULT 'unavailable'
                            CHECK (data_status IN ('live','stale','unavailable')),
  last_observed_at        TIMESTAMPTZ,           -- provider now − seen_pos (NULL = never)
  latitude                DOUBLE PRECISION,
  longitude               DOUBLE PRECISION,
  altitude_metres         DOUBLE PRECISION,      -- NULLABLE
  ground_speed_kt         DOUBLE PRECISION,      -- NULLABLE
  track_degrees           DOUBLE PRECISION,      -- NULLABLE
  vertical_rate_fpm       DOUBLE PRECISION,      -- NULLABLE
  on_ground               BOOLEAN,               -- NULLABLE (tri-state)
  seen_pos_seconds        DOUBLE PRECISION,      -- NULLABLE (duration)
  seen_seconds            DOUBLE PRECISION,      -- NULLABLE (duration)
  is_position_usable      BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_movement      TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (confirmed_movement IN ('airborne','ground','unknown')),
  candidate_movement      TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (candidate_movement IN ('airborne','ground','unknown')),
  candidate_count         INTEGER NOT NULL DEFAULT 0,
  airborne_episode_seq    BIGINT NOT NULL DEFAULT 0,
  not_seen_seq            BIGINT NOT NULL DEFAULT 0,
  last_provider_contact_at TIMESTAMPTZ,
  event_version           BIGINT NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Immutable transition/alert events (idempotent by dedup_key) ─────────────
CREATE TABLE IF NOT EXISTS aircraft_events (
  dedup_key      TEXT PRIMARY KEY,
  event_type     TEXT NOT NULL
                   CHECK (event_type IN ('takeoff','landing','telemetry_not_seen','reappeared','proximity_enter')),
  registration   TEXT NOT NULL,
  icao24         TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL,
  previous_state TEXT,
  current_state  TEXT,
  message        TEXT NOT NULL,
  user_id        BIGINT,                         -- set only for per-user events (proximity)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aircraft_events_reg_time ON aircraft_events(registration, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_aircraft_events_user_time ON aircraft_events(user_id, occurred_at DESC);

-- ── Worker heartbeat / provider health ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id                      BIGSERIAL PRIMARY KEY,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at             TIMESTAMPTZ,
  mode                    TEXT NOT NULL DEFAULT 'rest',
  success                 BOOLEAN NOT NULL DEFAULT FALSE,
  error_class             TEXT,
  error_message           TEXT,
  source_latency_ms       INTEGER,
  aircraft_count          INTEGER,
  last_successful_cycle_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started ON ingestion_runs(started_at DESC);

-- ── Users + sessions (multi-user auth) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,       -- scrypt, hex
  password_salt TEXT NOT NULL,       -- hex
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,      -- sha256 of the session token
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ── Per-user location (latest only, short expiry) ───────────────────────────
CREATE TABLE IF NOT EXISTS user_location_state (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  accuracy_m  DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- ── Per-user alert settings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_alert_settings (
  user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  push_token     TEXT,
  sms_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  sms_consent    BOOLEAN NOT NULL DEFAULT FALSE,
  sms_number_ref TEXT,
  enter_metres   INTEGER NOT NULL DEFAULT 30000,
  exit_metres    INTEGER NOT NULL DEFAULT 33000,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Per-user/per-aircraft proximity hysteresis state ────────────────────────
CREATE TABLE IF NOT EXISTS proximity_state (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registration TEXT NOT NULL,
  armed        BOOLEAN NOT NULL DEFAULT TRUE,
  inside       BOOLEAN NOT NULL DEFAULT FALSE,
  seq          BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, registration)
);

-- ── Notification delivery ledger (idempotent by dedup_key) ──────────────────
CREATE TABLE IF NOT EXISTS notification_deliveries (
  dedup_key       TEXT PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_dedup_key TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('push','sms','inapp')),
  status          TEXT NOT NULL DEFAULT 'recorded'
                    CHECK (status IN ('recorded','sent','failed','disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_deliveries_user ON notification_deliveries(user_id, created_at DESC);
