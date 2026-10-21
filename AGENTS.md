# PlacementAI — Project Rules (read before every task)

## Product
Student Placement Prediction System for a university placement cell. Admin-only web app
(no student logins). Modules: Admin Authentication, Dashboard, Student Management (CRUD +
CSV import/export), Placement Prediction (real scikit-learn model), Analytics & Reports
(interactive Plotly charts + exports), Skill Gap Analysis (rule engine + radar), Admin & Settings.

## Stack (do not substitute)
- frontend/: React 18 + Vite + JavaScript (JSX) + Tailwind CSS v3.4 + React Router v6
  + @supabase/supabase-js v2 + axios + react-plotly.js with plotly.js-dist-min + react-hot-toast
- backend/: Python 3.11+ (tested on 3.13), Flask 3, flask-cors, supabase (supabase-py v2), pydantic v2,
  PyJWT[crypto], pandas, scikit-learn, joblib, python-dotenv, pytest
- Database/Auth: Supabase Postgres + Supabase Auth (email/password)

## UI source of truth
- design/stitch/<screen>/code.html and screen.png are the reference designs.
  Reproduce layout, spacing, colors and typography faithfully.
- design/stitch/placement_analytics_system/DESIGN.md defines tokens and component rules.
- Copy the `tailwind.config` object from any Stitch code.html into frontend/tailwind.config.js
  unchanged. Where code.html and DESIGN.md conflict, code.html wins.
- Icons: Material Symbols Outlined (Google Fonts link), same names as in Stitch.
- Fonts: Hanken Grotesk (text) + JetBrains Mono (numbers, IDs, labels). Numeric columns
  use `font-variant-numeric: tabular-nums`.
- NEVER hardcode mock numbers, names or companies from the Stitch HTML. All data comes from the API.
  Show skeleton loaders while loading, empty states when there's no data, and error states on failure.
- Remove unbacked claims from the mockups (ISO 27001, AICTE Approved, SSL/AES badges, 2FA,
  NASSCOM, subnet binding, demo login presets).
- Responsive: sidebar becomes an off-canvas drawer under 1024px; tables scroll horizontally
  inside their card (never the page); grids collapse to 1 column on phones; 16px side gutter.

## Architecture rules
- Frontend talks ONLY to Flask for data (via src/services/api.js). It uses supabase-js ONLY
  for sign-in/sign-out/session. The access token goes in `Authorization: Bearer <jwt>`.
- Flask verifies the Supabase JWT on every /api route except GET /api/health.
- Local development may opt into `DEV_BYPASS_AUTH=true` (frontend: `VITE_DEV_BYPASS_AUTH=true`);
  it is off by default and bypasses authentication and RLS using the Supabase service-role key.
  It must be off before Phase 5 write-role tests or Phase 12 RBAC checks are considered verified.
- Local demo mode (`DATA_BACKEND=local`, the default when SUPABASE_URL is empty) swaps Supabase for a
  JSON store (app/services/local_db.py) that mimics the supabase-py query builder, plus Flask-issued
  HS256 sign-in tokens (POST /api/auth/login). Role decorators mirror the RLS policies so RBAC holds.
- Flask uses a user-scoped Supabase client (the caller's JWT) for data access so RLS applies.
  The secret/service-role key is used ONLY for admin user management and is never sent to the browser.
- Role check: the caller must have a row in public.admin_profiles; role-gated routes use a decorator.
- Validate every request body with pydantic. Return JSON errors: {"error": {"code", "message", "details"}}.
- Every write (create/update/delete/import/predict/settings change) inserts a row in public.audit_log.
- The ML model is loaded once at startup from backend/ml/artifacts/. Never train inside a request
  (retraining runs as a background job).
- Leakage guard: placement_status, company, package_lpa are NEVER model features.

## Shared field names (use exactly these everywhere: DB, API, ML, UI)
usn, full_name, email, department, batch_year, tenth_pct, twelfth_pct, cgpa,
aptitude_score, technical_score, communication_score, internships, projects,
certifications, backlogs, extracurricular, placement_training,
placement_status ('placed'|'in_process'|'not_placed'|'opted_out'), company, package_lpa
Skill scores (0–100): dsa, system_design, core_cs, aptitude, communication
Departments: 'CSE','IT','AIDS','ECE'

## Working style
- Build incrementally. Only touch files for the current phase unless a fix is required elsewhere.
- After each phase: run the app, run the tests, and report what passed or failed with real output.
- Never commit .env files. Keep .env.example updated with every new variable (no real values).
- Ask before adding a dependency that isn't listed above.