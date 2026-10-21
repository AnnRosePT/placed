"""Unit tests for the deterministic skill-gap rule engine."""
from app.services.skill_rules import analyze, severity_for

SETTINGS = {"skill_target": 75, "technical_threshold": 60, "aptitude_threshold": 65, "tier1_min_cgpa": 8.5}


def scores(**overrides):
    base = {"dsa": 80, "system_design": 80, "core_cs": 80, "aptitude": 80, "communication": 80}
    base.update(overrides)
    return base


def test_dsa_52_against_target_75_is_critical_priority_one():
    result = analyze(scores(dsa=52), 8.0, SETTINGS)
    dsa = next(a for a in result["axes"] if a["axis"] == "dsa")
    assert dsa["gap"] == 23 and dsa["severity"] == "critical"
    assert result["critical_domain"]["axis"] == "dsa"
    assert result["roadmap"][0]["priority"] == 1
    assert result["roadmap"][0]["code"] == "REM-DSA-01"
    assert "critical" in result["roadmap"][0]["diagnostic_trigger"]
    assert "technical floor" in dsa["trigger"]


def test_boundaries_exactly_at_thresholds():
    assert severity_for(20) == "critical"
    assert severity_for(19.9) == "needs_refinement"
    assert severity_for(0) == "meets"
    assert severity_for(-9.9) == "meets"
    assert severity_for(-10) == "surplus"
    result = analyze(scores(dsa=75), 8.0, SETTINGS)
    assert next(a for a in result["axes"] if a["axis"] == "dsa")["severity"] == "meets"


def test_priority_ordering_and_reinforcement_last():
    result = analyze(scores(dsa=50, system_design=70, core_cs=55, communication=95), 7.5, SETTINGS)
    priorities = [item["priority"] for item in result["roadmap"]]
    assert priorities == sorted(priorities)
    assert [i["axis"] for i in result["roadmap"][:2]] == ["dsa", "core_cs"]  # larger gap first
    assert result["roadmap"][-1]["type"] == "reinforcement"
    assert result["roadmap"][-1]["axis"] == "communication"


def test_skill_target_setting_changes_result():
    low = analyze(scores(dsa=70), 8.0, {**SETTINGS, "skill_target": 60})
    high = analyze(scores(dsa=70), 8.0, {**SETTINGS, "skill_target": 95})
    assert next(a for a in low["axes"] if a["axis"] == "dsa")["severity"] == "surplus"
    assert next(a for a in high["axes"] if a["axis"] == "dsa")["severity"] == "critical"


def test_tier_eligibility():
    assert analyze(scores(), 9.0, SETTINGS)["eligible_tier"]["key"] == "tier1"
    assert analyze(scores(dsa=40), 9.0, SETTINGS)["eligible_tier"]["key"] == "tier2"
    assert analyze(scores(dsa=40, core_cs=40), 6.5, SETTINGS)["eligible_tier"]["key"] == "foundation"
