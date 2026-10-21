"""Authorization tests for admin-protected Phase 4 endpoints."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.auth import decorators


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class FakeClient:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        assert name == "admin_profiles"
        return FakeQuery(self.rows)


@pytest.fixture

def mock_identity(monkeypatch):
    """Install deterministic verifier and user-scoped profile client mocks."""
    identity = {"user_id": "user-123", "email": "admin@example.edu"}
    monkeypatch.setattr(decorators, "verify_supabase_jwt", lambda _token: identity)

    def set_role(role: str | None):
        rows = [] if role is None else [
            {
                "user_id": identity["user_id"],
                "email": identity["email"],
                "full_name": "Test Admin",
                "role": role,
                "department": "CSE",
                "is_active": True,
            }
        ]
        monkeypatch.setattr(decorators, "get_user_client", lambda _token: FakeClient(rows))

    return set_role


def test_me_without_token_is_401(client, mock_identity):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "unauthorized"


def test_non_admin_is_403(client, mock_identity):
    mock_identity(None)
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer valid-token"})
    assert response.status_code == 403


def test_active_admin_can_read_me(client, mock_identity):
    mock_identity("placement_officer")
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer valid-token"})
    assert response.status_code == 200
    assert response.get_json() == {
        "user_id": "user-123",
        "email": "admin@example.edu",
        "full_name": "Test Admin",
        "role": "placement_officer",
        "department": "CSE",
        "last_sign_in_at": None,
    }


def test_faculty_mentor_cannot_update_settings(client, mock_identity):
    mock_identity("faculty_mentor")
    response = client.put(
        "/api/settings",
        json={"skill_target": 80},
        headers={"Authorization": "Bearer valid-token"},
    )
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "forbidden"
