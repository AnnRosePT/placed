-- =============================================================
-- PlacementAI — Supabase Postgres schema (Phase 2)
-- Safe to re-run. Apply in the Supabase SQL Editor as project owner.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
	CREATE TYPE public.placement_status AS ENUM ('placed', 'in_process', 'not_placed', 'opted_out');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
	CREATE TYPE public.admin_role AS ENUM ('super_admin', 'placement_officer', 'faculty_mentor', 'auditor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.admin_profiles (
	user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
	full_name text NOT NULL,
	email text NOT NULL,
	role public.admin_role NOT NULL DEFAULT 'placement_officer',
	department text CHECK (department IN ('CSE', 'IT', 'AIDS', 'ECE')),
	is_active boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.students (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	usn text NOT NULL UNIQUE,
	full_name text NOT NULL,
	email text,
	department text NOT NULL CHECK (department IN ('CSE', 'IT', 'AIDS', 'ECE')),
	batch_year integer NOT NULL,
	tenth_pct numeric(5,2) CHECK (tenth_pct BETWEEN 0 AND 100),
	twelfth_pct numeric(5,2) CHECK (twelfth_pct BETWEEN 0 AND 100),
	cgpa numeric(4,2) CHECK (cgpa BETWEEN 0 AND 10),
	aptitude_score integer CHECK (aptitude_score BETWEEN 0 AND 100),
	technical_score integer CHECK (technical_score BETWEEN 0 AND 100),
	communication_score integer CHECK (communication_score BETWEEN 0 AND 100),
	internships integer NOT NULL DEFAULT 0 CHECK (internships >= 0),
	projects integer NOT NULL DEFAULT 0 CHECK (projects >= 0),
	certifications integer NOT NULL DEFAULT 0 CHECK (certifications >= 0),
	backlogs integer NOT NULL DEFAULT 0 CHECK (backlogs >= 0),
	extracurricular boolean NOT NULL DEFAULT false,
	placement_training boolean NOT NULL DEFAULT false,
	placement_status public.placement_status NOT NULL DEFAULT 'in_process',
	company text,
	package_lpa numeric(6,2) CHECK (package_lpa >= 0),
	remediation_status text CHECK (remediation_status IS NULL OR remediation_status IN
		('enrolled', 'action_required', 'awaiting_retest', 'benchmark_met')),
	created_by uuid REFERENCES auth.users(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.skill_assessments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
	dsa integer NOT NULL CHECK (dsa BETWEEN 0 AND 100),
	system_design integer NOT NULL CHECK (system_design BETWEEN 0 AND 100),
	core_cs integer NOT NULL CHECK (core_cs BETWEEN 0 AND 100),
	aptitude integer NOT NULL CHECK (aptitude BETWEEN 0 AND 100),
	communication integer NOT NULL CHECK (communication BETWEEN 0 AND 100),
	assessed_at timestamptz NOT NULL DEFAULT now(),
	source text
);

CREATE TABLE IF NOT EXISTS public.predictions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
	features jsonb NOT NULL,
	probability numeric(5,4) NOT NULL CHECK (probability BETWEEN 0 AND 1),
	predicted_label text NOT NULL,
	model_version text NOT NULL,
	contributions jsonb,
	created_by uuid,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ml_models (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	version text NOT NULL UNIQUE,
	algorithm text NOT NULL,
	metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
	feature_list jsonb NOT NULL DEFAULT '[]'::jsonb,
	trained_at timestamptz NOT NULL DEFAULT now(),
	is_active boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.app_settings (
	key text PRIMARY KEY,
	value jsonb NOT NULL,
	updated_by uuid,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
	id bigserial PRIMARY KEY,
	actor uuid,
	action text NOT NULL,
	entity text NOT NULL,
	entity_id text,
	meta jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_exports (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	title text NOT NULL,
	type text NOT NULL CHECK (type IN ('csv', 'xlsx', 'pdf')),
	scope jsonb NOT NULL DEFAULT '{}'::jsonb,
	row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
	created_by uuid,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS students_department_batch_year_idx
	ON public.students (department, batch_year);
CREATE INDEX IF NOT EXISTS students_placement_status_idx
	ON public.students (placement_status);
CREATE INDEX IF NOT EXISTS students_cgpa_idx ON public.students (cgpa);
-- Existing databases: also run migrations/002_remediation_and_package_tiers.sql
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS remediation_status text;
CREATE INDEX IF NOT EXISTS students_remediation_status_idx ON public.students (remediation_status);
CREATE INDEX IF NOT EXISTS students_name_lower_idx ON public.students (lower(full_name));
CREATE INDEX IF NOT EXISTS students_usn_lower_idx ON public.students (lower(usn));
CREATE INDEX IF NOT EXISTS predictions_student_created_idx
	ON public.predictions (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ml_models_one_active_idx
	ON public.ml_models (is_active) WHERE is_active;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
	NEW.updated_at := now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_profiles_set_updated_at ON public.admin_profiles;
CREATE TRIGGER admin_profiles_set_updated_at
	BEFORE UPDATE ON public.admin_profiles
	FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS students_set_updated_at ON public.students;
CREATE TRIGGER students_set_updated_at
	BEFORE UPDATE ON public.students
	FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1 FROM public.admin_profiles
		WHERE user_id = (SELECT auth.uid()) AND is_active
	);
$$;

CREATE OR REPLACE FUNCTION public.has_role(VARIADIC roles public.admin_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1 FROM public.admin_profiles
		WHERE user_id = (SELECT auth.uid()) AND is_active AND role = ANY (roles)
	);
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(public.admin_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(public.admin_role[]) TO authenticated;

INSERT INTO public.app_settings (key, value) VALUES
	('tier1_min_cgpa', '8.5'::jsonb),
	('technical_threshold', '60'::jsonb),
	('aptitude_threshold', '65'::jsonb),
	('at_risk_probability', '0.5'::jsonb),
	('skill_target', '75'::jsonb),
	('placement_target_rate', '0.85'::jsonb),
	('high_potential_lpa', '6'::jsonb),
	('dream_lpa', '10'::jsonb),
	('super_dream_lpa', '20'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_profiles_select_admin ON public.admin_profiles;
CREATE POLICY admin_profiles_select_admin ON public.admin_profiles
	FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS admin_profiles_insert_super_admin ON public.admin_profiles;
CREATE POLICY admin_profiles_insert_super_admin ON public.admin_profiles
	FOR INSERT TO authenticated WITH CHECK (public.has_role('super_admin'));
DROP POLICY IF EXISTS admin_profiles_update_super_admin ON public.admin_profiles;
CREATE POLICY admin_profiles_update_super_admin ON public.admin_profiles
	FOR UPDATE TO authenticated USING (public.has_role('super_admin'))
	WITH CHECK (public.has_role('super_admin'));
DROP POLICY IF EXISTS admin_profiles_delete_super_admin ON public.admin_profiles;
CREATE POLICY admin_profiles_delete_super_admin ON public.admin_profiles
	FOR DELETE TO authenticated USING (public.has_role('super_admin'));

DROP POLICY IF EXISTS students_select_admin ON public.students;
CREATE POLICY students_select_admin ON public.students
	FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS students_insert_staff ON public.students;
CREATE POLICY students_insert_staff ON public.students
	FOR INSERT TO authenticated
	WITH CHECK (public.has_role('super_admin', 'placement_officer', 'faculty_mentor'));
DROP POLICY IF EXISTS students_update_staff ON public.students;
CREATE POLICY students_update_staff ON public.students
	FOR UPDATE TO authenticated
	USING (public.has_role('super_admin', 'placement_officer', 'faculty_mentor'))
	WITH CHECK (public.has_role('super_admin', 'placement_officer', 'faculty_mentor'));
DROP POLICY IF EXISTS students_delete_placement_staff ON public.students;
CREATE POLICY students_delete_placement_staff ON public.students
	FOR DELETE TO authenticated
	USING (public.has_role('super_admin', 'placement_officer'));

DROP POLICY IF EXISTS skill_assessments_select_admin ON public.skill_assessments;
CREATE POLICY skill_assessments_select_admin ON public.skill_assessments
	FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS skill_assessments_insert_staff ON public.skill_assessments;
CREATE POLICY skill_assessments_insert_staff ON public.skill_assessments
	FOR INSERT TO authenticated
	WITH CHECK (public.has_role('super_admin', 'placement_officer', 'faculty_mentor'));
DROP POLICY IF EXISTS skill_assessments_update_staff ON public.skill_assessments;
CREATE POLICY skill_assessments_update_staff ON public.skill_assessments
	FOR UPDATE TO authenticated
	USING (public.has_role('super_admin', 'placement_officer', 'faculty_mentor'))
	WITH CHECK (public.has_role('super_admin', 'placement_officer', 'faculty_mentor'));
DROP POLICY IF EXISTS skill_assessments_delete_placement_staff ON public.skill_assessments;
CREATE POLICY skill_assessments_delete_placement_staff ON public.skill_assessments
	FOR DELETE TO authenticated
	USING (public.has_role('super_admin', 'placement_officer'));

DROP POLICY IF EXISTS predictions_select_admin ON public.predictions;
CREATE POLICY predictions_select_admin ON public.predictions
	FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS predictions_insert_admin ON public.predictions;
CREATE POLICY predictions_insert_admin ON public.predictions
	FOR INSERT TO authenticated
	WITH CHECK (public.is_admin() AND created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS ml_models_select_admin ON public.ml_models;
CREATE POLICY ml_models_select_admin ON public.ml_models
	FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS ml_models_insert_super_admin ON public.ml_models;
CREATE POLICY ml_models_insert_super_admin ON public.ml_models
	FOR INSERT TO authenticated WITH CHECK (public.has_role('super_admin'));
DROP POLICY IF EXISTS ml_models_update_super_admin ON public.ml_models;
CREATE POLICY ml_models_update_super_admin ON public.ml_models
	FOR UPDATE TO authenticated USING (public.has_role('super_admin'))
	WITH CHECK (public.has_role('super_admin'));
DROP POLICY IF EXISTS ml_models_delete_super_admin ON public.ml_models;
CREATE POLICY ml_models_delete_super_admin ON public.ml_models
	FOR DELETE TO authenticated USING (public.has_role('super_admin'));

DROP POLICY IF EXISTS app_settings_select_admin ON public.app_settings;
CREATE POLICY app_settings_select_admin ON public.app_settings
	FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS app_settings_insert_super_admin ON public.app_settings;
CREATE POLICY app_settings_insert_super_admin ON public.app_settings
	FOR INSERT TO authenticated WITH CHECK (public.has_role('super_admin'));
DROP POLICY IF EXISTS app_settings_update_super_admin ON public.app_settings;
CREATE POLICY app_settings_update_super_admin ON public.app_settings
	FOR UPDATE TO authenticated USING (public.has_role('super_admin'))
	WITH CHECK (public.has_role('super_admin'));
DROP POLICY IF EXISTS app_settings_delete_super_admin ON public.app_settings;
CREATE POLICY app_settings_delete_super_admin ON public.app_settings
	FOR DELETE TO authenticated USING (public.has_role('super_admin'));

DROP POLICY IF EXISTS audit_log_insert_admin ON public.audit_log;
CREATE POLICY audit_log_insert_admin ON public.audit_log
	FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS audit_log_select_auditor ON public.audit_log;
CREATE POLICY audit_log_select_auditor ON public.audit_log
	FOR SELECT TO authenticated USING (public.has_role('super_admin', 'auditor'));

DROP POLICY IF EXISTS report_exports_select_admin ON public.report_exports;
CREATE POLICY report_exports_select_admin ON public.report_exports
	FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS report_exports_insert_admin ON public.report_exports;
CREATE POLICY report_exports_insert_admin ON public.report_exports
	FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- There are no anon policies: anon SELECT is filtered to zero rows by RLS.
-- Anonymous writes are denied by table privileges.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
REVOKE ALL ON TABLE public.admin_profiles, public.students, public.skill_assessments,
	public.predictions, public.ml_models, public.app_settings, public.audit_log,
	public.report_exports FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.admin_profiles, public.students, public.skill_assessments,
	public.predictions, public.ml_models, public.app_settings, public.audit_log,
	public.report_exports TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_profiles, public.students,
	public.skill_assessments, public.ml_models, public.app_settings TO authenticated;
GRANT SELECT, INSERT ON TABLE public.predictions, public.audit_log, public.report_exports
	TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO authenticated;
