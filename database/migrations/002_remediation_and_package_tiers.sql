-- =============================================================
-- PlacementAI — migration 002 (Phases 10–11). Safe to re-run.
-- Adds students.remediation_status and package-tier cutoff settings.
-- schema.sql already contains these changes for fresh installs.
-- =============================================================
ALTER TABLE public.students
	ADD COLUMN IF NOT EXISTS remediation_status text;

DO $$ BEGIN
	ALTER TABLE public.students
		ADD CONSTRAINT students_remediation_status_check
		CHECK (remediation_status IS NULL OR remediation_status IN
			('enrolled', 'action_required', 'awaiting_retest', 'benchmark_met'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS students_remediation_status_idx
	ON public.students (remediation_status);

INSERT INTO public.app_settings (key, value) VALUES
	('high_potential_lpa', '6'::jsonb),
	('dream_lpa', '10'::jsonb),
	('super_dream_lpa', '20'::jsonb)
ON CONFLICT (key) DO NOTHING;
