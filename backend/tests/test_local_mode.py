"""End-to-end API tests against the local demo store (real query semantics, real model)."""
from __future__ import annotations

import io
import time

import numpy as np
import pytest

from app import create_app
from app.config import TestingConfig
from ml.generate_synthetic import generate_synthetic
from ml.train import train_model

ADMIN = ("admin@placementai.local", "Admin@123")


@pytest.fixture(scope="session")
def model_dir(tmp_path_factory):
    path = tmp_path_factory.mktemp("model")
    train_model(generate_synthetic(n_rows=1500, random_state=7), dataset_source="synthetic", output_dir=path)
    return path


@pytest.fixture()
def local(tmp_path, model_dir):
    class LocalConfig(TestingConfig):
        DATA_BACKEND = "local"
        LOCAL_DB_PATH = str(tmp_path / "db.json")
        MODEL_DIR = str(model_dir)
        SECRET_KEY = "test-secret"

    app = create_app(LocalConfig)
    client = app.test_client()
    return app, client


def login(client, email=ADMIN[0], password=ADMIN[1]):
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.get_json()
    return {"Authorization": f"Bearer {response.get_json()['access_token']}"}


def test_login_and_me(local):
    _, client = local
    assert client.post("/api/auth/login", json={"email": ADMIN[0], "password": "wrong"}).status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    headers = login(client)
    me = client.get("/api/auth/me", headers=headers).get_json()
    assert me["role"] == "super_admin" and me["last_sign_in_at"]
    health = client.get("/api/health").get_json()
    assert health["auth_mode"] == "local" and health["model_loaded"] and health["db"] == "ok"


def test_seeded_students_and_dashboard_counts(local):
    _, client = local
    h = login(client)
    listing = client.get("/api/students?per_page=100", headers=h).get_json()
    assert listing["total"] == 40
    dash = client.get("/api/dashboard", headers=h).get_json()
    items = listing["items"]
    statuses = {s: sum(i["placement_status"] == s for i in items) for s in ("placed", "in_process", "not_placed", "opted_out")}
    assert dash["outcome_distribution"] == statuses
    assert dash["kpis"]["total_eligible"] == 40 - statuses["opted_out"]
    assert dash["kpis"]["placed"] == statuses["placed"]
    assert sum(d["placed"] for d in dash["department_performance"]) == statuses["placed"]
    cse = client.get("/api/dashboard?department=CSE", headers=h).get_json()
    assert cse["kpis"]["total_students"] == 10
    assert client.get("/api/dashboard?department=XYZ", headers=h).status_code == 400
    assert dash["recent_activity"] is not None


def test_predictions_manual_student_batch(local):
    _, client = local
    h = login(client)
    model = client.get("/api/model", headers=h).get_json()
    assert model["loaded"] and model["leakage_guard"]
    assert "placement_status" not in model["features"]
    base = {"tenth_pct": 80, "twelfth_pct": 80, "aptitude_score": 75, "communication_score": 70,
            "internships": 1, "projects": 2, "certifications": 1, "extracurricular": True,
            "placement_training": True}
    low = client.post("/api/predict", json={"features": {**base, "cgpa": 6.0, "aptitude_score": 50}}, headers=h).get_json()
    high = client.post("/api/predict", json={"features": {**base, "cgpa": 9.4, "aptitude_score": 92}}, headers=h).get_json()
    assert 0 <= low["probability"] <= 1 and high["probability"] > low["probability"]
    assert high["contributions"] and high["advisory"]["points"] and high["confidence"] in {"high", "medium", "low"}
    bad = client.post("/api/predict", json={"features": {"cgpa": 14}}, headers=h)
    assert bad.status_code == 400
    assert client.post("/api/predict", json={"features": {"salary": 1}}, headers=h).status_code == 400

    student = client.get("/api/students?search=1XX21CS004", headers=h).get_json()["items"][0]
    saved = client.post("/api/predict", json={"student_id": student["id"], "save": True}, headers=h).get_json()
    assert saved["saved"] and saved["student"]["usn"] == "1XX21CS004"
    history = client.get(f"/api/predictions?student_id={student['id']}", headers=h).get_json()
    assert history["total"] == 1 and history["items"][0]["student"]["usn"] == "1XX21CS004"

    batch = client.post("/api/predict/batch", json={}, headers=h).get_json()
    assert batch["count"] == 36  # 40 seeded minus 4 opted out
    assert batch["placed_pred"] + batch["at_risk"] == 36
    again = client.post("/api/predict/batch", json={"only_unpredicted": True}, headers=h).get_json()
    assert again["count"] == 0
    export = client.get("/api/predictions/export.csv", headers=h)
    assert export.status_code == 200 and export.get_data(as_text=True).count("\n") == 38
    audit = client.get("/api/admin/audit?action=predict_batch", headers=h).get_json()
    assert audit["total"] == 1


def test_analytics_and_reports(local):
    _, client = local
    h = login(client)
    students = client.get("/api/students?per_page=100", headers=h).get_json()["items"]
    placed = sum(s["placement_status"] == "placed" for s in students)
    overview = client.get("/api/analytics/overview", headers=h).get_json()
    assert overview["placed"] == placed and overview["max_package_company"] == "Google"
    corr = client.get("/api/analytics/cgpa-correlation", headers=h).get_json()
    decided = [s for s in students if s["placement_status"] in ("placed", "not_placed")]
    expected = np.corrcoef([s["cgpa"] for s in decided], [s["placement_status"] == "placed" for s in decided])[0, 1]
    assert corr["pearson_r"] == pytest.approx(expected, abs=1e-4)
    assert sum(b["count"] for b in client.get("/api/analytics/packages", headers=h).get_json()["bins"]) == placed
    skills = client.get("/api/analytics/skills", headers=h).get_json()
    assert {i["department"] for i in skills["items"]} == {"CSE", "IT", "AIDS", "ECE"}
    xlsx = client.get("/api/reports/company-audit.xlsx", headers=h)
    assert xlsx.status_code == 200 and xlsx.data[:2] == b"PK"
    ledger = client.get("/api/reports/department-ledger.csv", headers=h)
    assert "department,enrolled" in ledger.get_data(as_text=True)
    history = client.get("/api/reports/history", headers=h).get_json()["items"]
    assert [r["type"] for r in history][:2] == ["csv", "xlsx"]


def test_skill_gap_remediation_and_settings(local):
    _, client = local
    h = login(client)
    student = client.get("/api/students?search=1XX21CS009", headers=h).get_json()["items"][0]
    gap = client.get(f"/api/skills/gap/{student['id']}", headers=h).get_json()
    assert gap["critical_domain"]["axis"] == "system_design"  # 42 vs target 75
    assert gap["roadmap"][0]["priority"] == 1
    # Raising/lowering the target in settings changes the analysis
    assert client.put("/api/settings", json={"skill_target": 50}, headers=h).status_code == 200
    relaxed = client.get(f"/api/skills/gap/{student['id']}", headers=h).get_json()
    assert relaxed["critical_count"] < gap["critical_count"]
    assert client.put("/api/settings", json={"dream_lpa": 50}, headers=h).status_code == 400  # > super dream
    created = client.post("/api/students", json={"usn": "NEW001", "full_name": "No Skills", "department": "IT",
                                                 "batch_year": 2025}, headers=h).get_json()
    missing = client.get(f"/api/skills/gap/{created['id']}", headers=h)
    assert missing.status_code == 404 and "no skill assessment" in missing.get_json()["error"]["message"]
    patched = client.patch(f"/api/skills/remediation/{student['id']}", json={"status": "enrolled"}, headers=h)
    assert patched.get_json()["remediation_status"] == "enrolled"
    assert client.patch(f"/api/skills/remediation/{student['id']}", json={"status": "bogus"}, headers=h).status_code == 400
    sync = client.post("/api/skills/cohort/sync", headers=h).get_json()
    assert sync["evaluated"] == 41 and sync["kept"] == 1 and sync["unassessed"] == 1
    cohort = client.get("/api/skills/cohort?severity=unassessed", headers=h).get_json()
    assert cohort["total"] == 1
    assert client.get(f"/api/skills/gap/{student['id']}/export.csv", headers=h).status_code == 200


def test_rbac_with_created_placement_officer(local):
    _, client = local
    h = login(client)
    created = client.post("/api/admin/users", json={"email": "po@college.edu", "full_name": "Placement Officer",
                                                    "role": "placement_officer", "department": "CSE"}, headers=h)
    assert created.status_code == 201
    body = created.get_json()
    assert client.post("/api/admin/users", json={"email": "po@college.edu", "full_name": "x"}, headers=h).status_code == 409
    po = login(client, "po@college.edu", body["temporary_password"])
    assert client.get("/api/admin/users", headers=po).status_code == 403
    assert client.put("/api/settings", json={"skill_target": 70}, headers=po).status_code == 403
    student = client.get("/api/students?search=1XX21EC009", headers=po).get_json()["items"][0]
    assert client.delete(f"/api/students/{student['id']}", headers=po).status_code == 204
    me = client.get("/api/auth/me", headers=h).get_json()
    assert client.patch(f"/api/admin/users/{me['user_id']}", json={"is_active": False}, headers=h).status_code == 409
    assert client.patch(f"/api/admin/users/{me['user_id']}", json={"role": "auditor"}, headers=h).status_code == 409
    assert client.patch(f"/api/admin/users/{body['user_id']}", json={"is_active": False}, headers=h).status_code == 200
    blocked = client.post("/api/auth/login", json={"email": "po@college.edu", "password": body["temporary_password"]})
    assert blocked.status_code == 403
    audit_csv = client.get("/api/admin/audit/export.csv", headers=h).get_data(as_text=True)
    assert "admin_profiles" in audit_csv


def test_model_versions_activate_and_retrain(local, monkeypatch):
    app, client = local
    h = login(client)
    overview = client.get("/api/admin/model", headers=h).get_json()
    assert overview["versions"] and overview["versions"][0]["is_active"]
    version = overview["versions"][0]["version"]
    assert client.post(f"/api/admin/model/activate/{version}", headers=h).status_code == 200
    assert client.post("/api/admin/model/activate/..evil", headers=h).status_code == 404

    import app.routes.admin as admin_routes

    def fake_run(app_obj, job_id, actor):
        admin_routes._jobs[job_id].update(status="succeeded", version=version)

    monkeypatch.setattr(admin_routes, "_run_job", fake_run)
    job = client.post("/api/admin/model/retrain", headers=h).get_json()
    for _ in range(50):
        status = client.get(f"/api/admin/model/jobs/{job['id']}", headers=h).get_json()
        if status["status"] == "succeeded":
            break
        time.sleep(0.05)
    assert status["status"] == "succeeded"
