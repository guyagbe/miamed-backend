require('dotenv').config();
const { pool } = require('./db');

const schema = `

-- ─────────────────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fuzzy text search

-- ─────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role        AS ENUM ('patient', 'doctor', 'admin');
  CREATE TYPE appt_status      AS ENUM ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');
  CREATE TYPE consult_type     AS ENUM ('in_person', 'teleconsult', 'both');
  CREATE TYPE gender_type      AS ENUM ('male', 'female', 'non_binary', 'prefer_not_to_say');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────
-- USERS  (patients + doctors + admins share one auth table)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            user_role NOT NULL DEFAULT 'patient',
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  phone           VARCHAR(30),
  date_of_birth   DATE,
  gender          gender_type,
  avatar_url      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  refresh_token   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

-- ─────────────────────────────────────────────────────────
-- SPECIALTIES
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS specialties (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) UNIQUE NOT NULL,
  slug        VARCHAR(100) UNIQUE NOT NULL,
  icon        VARCHAR(10),
  description TEXT
);

-- ─────────────────────────────────────────────────────────
-- DOCTORS  (extends users where role = 'doctor')
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialty_id      INT  NOT NULL REFERENCES specialties(id),
  license_number    VARCHAR(100) UNIQUE NOT NULL,
  bio               TEXT,
  years_experience  INT NOT NULL DEFAULT 0,
  medical_school    VARCHAR(200),
  consult_type      consult_type NOT NULL DEFAULT 'both',
  consultation_fee  NUMERIC(8,2) NOT NULL DEFAULT 0,
  address           TEXT,
  neighborhood      VARCHAR(100),
  city              VARCHAR(100) NOT NULL DEFAULT 'Miami',
  state             VARCHAR(10)  NOT NULL DEFAULT 'FL',
  zip               VARCHAR(10),
  latitude          NUMERIC(9,6),
  longitude         NUMERIC(9,6),
  languages         TEXT[] NOT NULL DEFAULT '{"English"}',
  insurances        TEXT[] NOT NULL DEFAULT '{}',
  is_accepting_new  BOOLEAN NOT NULL DEFAULT TRUE,
  rating_avg        NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count      INT          NOT NULL DEFAULT 0,
  is_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctors_user_id     ON doctors(user_id);
CREATE INDEX IF NOT EXISTS idx_doctors_specialty    ON doctors(specialty_id);
CREATE INDEX IF NOT EXISTS idx_doctors_neighborhood ON doctors(neighborhood);
CREATE INDEX IF NOT EXISTS idx_doctors_rating       ON doctors(rating_avg DESC);
CREATE INDEX IF NOT EXISTS idx_doctors_languages    ON doctors USING GIN(languages);
CREATE INDEX IF NOT EXISTS idx_doctors_insurances   ON doctors USING GIN(insurances);

-- ─────────────────────────────────────────────────────────
-- AVAILABILITY TEMPLATES  (recurring weekly schedule)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS availability_templates (
  id          SERIAL PRIMARY KEY,
  doctor_id   UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  day_of_week INT  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  slot_minutes INT NOT NULL DEFAULT 30,
  consult_type consult_type NOT NULL DEFAULT 'both',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(doctor_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_avail_doctor ON availability_templates(doctor_id);

-- ─────────────────────────────────────────────────────────
-- AVAILABILITY OVERRIDES  (day off, holiday, one-time block)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS availability_overrides (
  id          SERIAL PRIMARY KEY,
  doctor_id   UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  override_date DATE NOT NULL,
  is_day_off  BOOLEAN NOT NULL DEFAULT FALSE,
  start_time  TIME,
  end_time    TIME,
  reason      VARCHAR(200),
  UNIQUE(doctor_id, override_date)
);

-- ─────────────────────────────────────────────────────────
-- APPOINTMENTS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id      UUID NOT NULL REFERENCES users(id),
  doctor_id       UUID NOT NULL REFERENCES doctors(id),
  appt_date       DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  consult_type    consult_type NOT NULL DEFAULT 'in_person',
  status          appt_status NOT NULL DEFAULT 'confirmed',
  reason          TEXT,
  notes           TEXT,
  cancellation_reason TEXT,
  cancelled_by    UUID REFERENCES users(id),
  cancelled_at    TIMESTAMPTZ,
  teleconsult_url TEXT,
  reference_code  VARCHAR(20) UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appt_patient  ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_doctor   ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appt_date     ON appointments(appt_date);
CREATE INDEX IF NOT EXISTS idx_appt_status   ON appointments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appt_slot
  ON appointments(doctor_id, appt_date, start_time)
  WHERE status NOT IN ('cancelled');

-- ─────────────────────────────────────────────────────────
-- REVIEWS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appointment_id  UUID UNIQUE NOT NULL REFERENCES appointments(id),
  patient_id      UUID NOT NULL REFERENCES users(id),
  doctor_id       UUID NOT NULL REFERENCES doctors(id),
  rating          INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  is_anonymous    BOOLEAN NOT NULL DEFAULT FALSE,
  is_visible      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_doctor  ON reviews(doctor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_patient ON reviews(patient_id);

-- ─────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT; BEGIN
  FOR t IN SELECT unnest(ARRAY['users','doctors','appointments']) LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_updated_at ON %I;
      CREATE TRIGGER trg_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    ', t, t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────
-- TRIGGER: recompute doctor rating after review insert/update
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_doctor_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE doctors
  SET rating_avg   = (SELECT ROUND(AVG(rating)::NUMERIC, 2) FROM reviews WHERE doctor_id = NEW.doctor_id AND is_visible),
      rating_count = (SELECT COUNT(*) FROM reviews WHERE doctor_id = NEW.doctor_id AND is_visible)
  WHERE id = NEW.doctor_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rating ON reviews;
CREATE TRIGGER trg_rating
  AFTER INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION refresh_doctor_rating();
`;

async function migrate() {
  console.log('🔄  Running migrations...');
  try {
    await pool.query(schema);
    console.log('✅  All tables created successfully.');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
