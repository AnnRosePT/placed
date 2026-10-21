-- =============================================================
-- PlacementAI — RLS verification script (Phase 13)
-- Run in the Supabase SQL editor AFTER schema.sql and seed.sql.
-- It impersonates roles inside a transaction and ROLLS BACK, so it changes nothing.
-- Replace the two UUIDs with a real faculty_mentor and super_admin user_id.
-- Each SELECT prints PASS/FAIL.
-- =============================================================
BEGIN;

-- 1. anon sees nothing
SET LOCAL ROLE anon;
SELECT CASE WHEN count(*) = 0 THEN 'PASS anon students=0' ELSE 'FAIL anon can read students' END FROM public.students;
SELECT CASE WHEN count(*) = 0 THEN 'PASS anon audit_log=0' ELSE 'FAIL anon can read audit_log' END FROM public.audit_log;
RESET ROLE;

-- 2. faculty_mentor can read but cannot delete students
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'FACULTY-MENTOR-UUID', 'role', 'authenticated')::text, true);
SELECT CASE WHEN count(*) > 0 THEN 'PASS mentor can read students' ELSE 'FAIL mentor cannot read students' END FROM public.students;
WITH deleted AS (DELETE FROM public.students RETURNING id)
SELECT CASE WHEN count(*) = 0 THEN 'PASS mentor delete blocked' ELSE 'FAIL mentor deleted rows' END FROM deleted;
WITH changed AS (UPDATE public.app_settings SET value = '99'::jsonb WHERE key = 'skill_target' RETURNING key)
SELECT CASE WHEN count(*) = 0 THEN 'PASS mentor settings write blocked' ELSE 'FAIL mentor changed settings' END FROM changed;
SELECT CASE WHEN count(*) = 0 THEN 'PASS mentor cannot read audit_log' ELSE 'FAIL mentor reads audit_log' END FROM public.audit_log;
RESET ROLE;

-- 3. super_admin can update settings (rolled back below)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'SUPER-ADMIN-UUID', 'role', 'authenticated')::text, true);
WITH changed AS (UPDATE public.app_settings SET value = value WHERE key = 'skill_target' RETURNING key)
SELECT CASE WHEN count(*) = 1 THEN 'PASS super_admin settings write' ELSE 'FAIL super_admin blocked' END FROM changed;
RESET ROLE;

ROLLBACK;
