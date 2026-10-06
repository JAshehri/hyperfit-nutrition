-- HyperFit Nutrition — PostgreSQL schema v1
-- The application sets app.user_id and app.user_role at the beginning of each transaction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE account_role AS ENUM ('CLIENT', 'DOCTOR', 'ADMIN');
CREATE TYPE account_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE sex_code AS ENUM ('MALE', 'FEMALE');
CREATE TYPE goal_code AS ENUM ('LOSS', 'GAIN', 'MAINTAIN', 'SPECIAL');
CREATE TYPE plan_status AS ENUM ('DRAFT', 'ACTIVE');
CREATE TYPE meal_slot_type AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'CUSTOM');
CREATE TYPE food_state AS ENUM ('RAW', 'COOKED', 'AS_EATEN');

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    phone text,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    role account_role NOT NULL,
    status account_status NOT NULL DEFAULT 'PENDING',
    locale text NOT NULL DEFAULT 'ar-SA',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT ck_users_email_normalized CHECK (email = lower(trim(email)))
);

CREATE TABLE doctor_profiles (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    license_number text NOT NULL UNIQUE,
    specialty text NOT NULL,
    can_approve boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE client_profiles (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    age integer NOT NULL CHECK (age BETWEEN 18 AND 100),
    sex sex_code NOT NULL,
    height_cm real NOT NULL CHECK (height_cm BETWEEN 100 AND 250),
    weight_kg real NOT NULL CHECK (weight_kg BETWEEN 25 AND 500),
    body_fat_pct real CHECK (body_fat_pct > 0 AND body_fat_pct < 80),
    activity_level text NOT NULL CHECK (activity_level IN ('SEDENTARY','LIGHT','MODERATE','HIGH','VERY_HIGH')),
    default_goal goal_code NOT NULL DEFAULT 'MAINTAIN',
    medical_notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    ip_hash text,
    user_agent_hash text
);

CREATE TABLE food_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name_ar text NOT NULL,
    name_en text,
    category text NOT NULL,
    state food_state NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE food_item_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    food_id uuid NOT NULL REFERENCES food_items(id) ON DELETE RESTRICT,
    revision_no integer NOT NULL CHECK (revision_no > 0),
    kcal_per_100g real NOT NULL CHECK (kcal_per_100g >= 0),
    protein_g_per_100g real NOT NULL CHECK (protein_g_per_100g >= 0),
    carb_g_per_100g real NOT NULL CHECK (carb_g_per_100g >= 0),
    fat_g_per_100g real NOT NULL CHECK (fat_g_per_100g >= 0),
    source_name text NOT NULL,
    effective_at timestamptz NOT NULL DEFAULT now(),
    approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    UNIQUE (food_id, revision_no)
);

-- Explicit meal boundaries. A food is never eligible for every meal implicitly.
CREATE TABLE food_meal_eligibility (
    food_id uuid NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    meal_type meal_slot_type NOT NULL,
    is_allowed boolean NOT NULL DEFAULT true,
    priority smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
    PRIMARY KEY (food_id, meal_type)
);

CREATE TABLE nutrition_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES client_profiles(user_id) ON DELETE RESTRICT,
    current_version_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nutrition_profile_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nutrition_profile_id uuid NOT NULL REFERENCES nutrition_profiles(id) ON DELETE RESTRICT,
    version_no integer NOT NULL CHECK (version_no > 0),
    status plan_status NOT NULL DEFAULT 'DRAFT',
    age integer NOT NULL CHECK (age BETWEEN 18 AND 100),
    sex sex_code NOT NULL,
    height_cm real NOT NULL CHECK (height_cm BETWEEN 100 AND 250),
    weight_kg real NOT NULL CHECK (weight_kg BETWEEN 25 AND 500),
    body_fat_pct real CHECK (body_fat_pct > 0 AND body_fat_pct < 80),
    activity_level text NOT NULL CHECK (activity_level IN ('SEDENTARY','LIGHT','MODERATE','HIGH','VERY_HIGH')),
    goal goal_code NOT NULL,
    adjustment_kcal real NOT NULL DEFAULT 0 CHECK (adjustment_kcal BETWEEN 0 AND 2000),
    formula_code text NOT NULL CHECK (formula_code IN ('MIFFLIN_ST_JEOR','KATCH_MCARDLE')),
    formula_version text NOT NULL,
    lbm_kg real,
    bmr_kcal real NOT NULL CHECK (bmr_kcal > 0),
    tdee_kcal real NOT NULL CHECK (tdee_kcal > 0),
    daily_target_kcal real NOT NULL CHECK (daily_target_kcal > 0),
    protein_g real NOT NULL CHECK (protein_g >= 0),
    carb_g real NOT NULL CHECK (carb_g >= 0),
    fat_g real NOT NULL CHECK (fat_g >= 0),
    input_snapshot jsonb NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (nutrition_profile_id, version_no),
    CHECK (status != 'ACTIVE' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

ALTER TABLE nutrition_profiles
    ADD CONSTRAINT fk_nutrition_profiles_current_version
    FOREIGN KEY (current_version_id) REFERENCES nutrition_profile_versions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_active_profile_version
    ON nutrition_profile_versions(nutrition_profile_id)
    WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX uq_working_profile_version
    ON nutrition_profile_versions(nutrition_profile_id)
    WHERE status = 'DRAFT';

CREATE TABLE meal_slot_definitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_version_id uuid NOT NULL REFERENCES nutrition_profile_versions(id) ON DELETE RESTRICT,
    slot_order smallint NOT NULL CHECK (slot_order > 0),
    meal_type meal_slot_type NOT NULL,
    display_name text NOT NULL,
    calorie_pct real NOT NULL CHECK (calorie_pct > 0 AND calorie_pct <= 100),
    target_kcal real NOT NULL CHECK (target_kcal > 0),
    target_protein_g real NOT NULL CHECK (target_protein_g >= 0),
    target_carb_g real NOT NULL CHECK (target_carb_g >= 0),
    target_fat_g real NOT NULL CHECK (target_fat_g >= 0),
    UNIQUE (profile_version_id, slot_order)
);

CREATE TABLE meal_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_version_id uuid NOT NULL REFERENCES nutrition_profile_versions(id) ON DELETE RESTRICT,
    plan_date date,
    status plan_status NOT NULL DEFAULT 'DRAFT',
    generation_seed text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meal_plan_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meal_plan_id uuid NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
    meal_slot_id uuid NOT NULL REFERENCES meal_slot_definitions(id) ON DELETE RESTRICT,
    name text NOT NULL,
    preparation_steps text,
    kcal real NOT NULL CHECK (kcal > 0),
    protein_g real NOT NULL CHECK (protein_g >= 0),
    carb_g real NOT NULL CHECK (carb_g >= 0),
    fat_g real NOT NULL CHECK (fat_g >= 0),
    fingerprint text NOT NULL,
    selected boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (meal_plan_id, fingerprint)
);

CREATE TABLE meal_ingredients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meal_item_id uuid NOT NULL REFERENCES meal_plan_items(id) ON DELETE CASCADE,
    food_revision_id uuid NOT NULL REFERENCES food_item_revisions(id) ON DELETE RESTRICT,
    grams real NOT NULL CHECK (grams > 0),
    kcal_snapshot real NOT NULL CHECK (kcal_snapshot >= 0),
    protein_snapshot real NOT NULL CHECK (protein_snapshot >= 0),
    carb_snapshot real NOT NULL CHECK (carb_snapshot >= 0),
    fat_snapshot real NOT NULL CHECK (fat_snapshot >= 0)
);

CREATE TABLE daily_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES client_profiles(user_id) ON DELETE RESTRICT,
    profile_version_id uuid NOT NULL REFERENCES nutrition_profile_versions(id) ON DELETE RESTRICT,
    local_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client_id, local_date)
);

CREATE TABLE meal_completion_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_log_id uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
    meal_item_id uuid NOT NULL REFERENCES meal_plan_items(id) ON DELETE RESTRICT,
    completed boolean NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id bigserial PRIMARY KEY,
    actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    before_hash text,
    after_hash text,
    request_id text,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_profiles_client ON nutrition_profiles(client_id);
CREATE INDEX ix_versions_profile_created ON nutrition_profile_versions(nutrition_profile_id, created_at DESC);
CREATE INDEX ix_meal_plans_version ON meal_plans(profile_version_id);
CREATE INDEX ix_daily_logs_client_date ON daily_logs(client_id, local_date DESC);
CREATE INDEX ix_audit_actor_time ON audit_logs(actor_id, occurred_at DESC);

CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app_user_role() RETURNS account_role LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.user_role', true), '')::account_role
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

-- Clients are shared at system level: every doctor and admin can see every client.
-- There is deliberately no doctor/client assignment table.
CREATE POLICY users_role_access ON users
    FOR SELECT
    USING (
        id = app_user_id()
        OR app_user_role() = 'ADMIN'
        OR (app_user_role() = 'DOCTOR' AND role = 'CLIENT')
    );

CREATE POLICY users_staff_insert ON users
    FOR INSERT
    WITH CHECK (
        app_user_role() = 'ADMIN'
        OR (app_user_role() = 'DOCTOR' AND role = 'CLIENT')
    );

CREATE POLICY clients_role_access ON client_profiles
    USING (
        user_id = app_user_id()
        OR app_user_role() = 'ADMIN'
        OR app_user_role() = 'DOCTOR'
    );

CREATE POLICY profiles_role_access ON nutrition_profiles
    USING (
        client_id = app_user_id()
        OR app_user_role() = 'ADMIN'
        OR app_user_role() = 'DOCTOR'
    );

CREATE POLICY versions_role_access ON nutrition_profile_versions
    USING (
        app_user_role() = 'ADMIN'
        OR app_user_role() = 'DOCTOR'
        OR EXISTS (
            SELECT 1 FROM nutrition_profiles p
            WHERE p.id = nutrition_profile_id
              AND p.client_id = app_user_id()
        )
    );

CREATE POLICY daily_logs_role_access ON daily_logs
    USING (
        client_id = app_user_id()
        OR app_user_role() = 'ADMIN'
        OR app_user_role() = 'DOCTOR'
    );

-- Application rule for applying adjustment exactly once:
-- signed_adjustment = CASE goal
--   WHEN 'LOSS' THEN -ABS(adjustment_kcal)
--   WHEN 'GAIN' THEN  ABS(adjustment_kcal)
--   WHEN 'MAINTAIN' THEN 0
--   ELSE doctor-provided signed special adjustment
-- END;
-- daily_target_kcal = tdee_kcal + signed_adjustment;
