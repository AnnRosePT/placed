"""Deterministic, transparent skill-gap rule engine (Phase 11).

Every rule is a fixed threshold read from app_settings; no ML is involved.
"""
from __future__ import annotations

from typing import Any

from .skill_catalog import AXIS_LABELS, REINFORCEMENT, REMEDIATION

AXES = ("dsa", "system_design", "core_cs", "aptitude", "communication")
TECHNICAL_AXES = {"dsa", "system_design", "core_cs"}
CRITICAL_GAP = 20
SURPLUS_MARGIN = 10


def _f(settings: dict[str, Any], key: str, default: float) -> float:
    try:
        return float(settings.get(key, default))
    except (TypeError, ValueError):
        return float(default)


def severity_for(gap: float) -> str:
    if gap >= CRITICAL_GAP:
        return "critical"
    if gap > 0:
        return "needs_refinement"
    if -gap >= SURPLUS_MARGIN:
        return "surplus"
    return "meets"


def analyze(assessment: dict[str, Any], cgpa: float | None, settings: dict[str, Any]) -> dict[str, Any]:
    target_default = _f(settings, "skill_target", 75)
    technical_threshold = _f(settings, "technical_threshold", 60)
    aptitude_threshold = _f(settings, "aptitude_threshold", 65)
    tier1_cgpa = _f(settings, "tier1_min_cgpa", 8.5)

    axes = []
    for axis in AXES:
        score = float(assessment.get(axis) or 0)
        target = _f(settings, f"skill_target_{axis}", target_default)
        gap = round(target - score, 1)
        severity = severity_for(gap)
        floor_breach = None
        if axis in TECHNICAL_AXES and score < technical_threshold:
            floor_breach = f"below the technical floor of {technical_threshold:g}"
        if axis == "aptitude" and score < aptitude_threshold:
            floor_breach = f"below the aptitude floor of {aptitude_threshold:g}"
        if severity == "critical":
            trigger = f"{AXIS_LABELS[axis]} score {score:g}/100 is {gap:g} points under the target {target:g} (gap ≥ {CRITICAL_GAP} → critical)."
        elif severity == "needs_refinement":
            trigger = f"{AXIS_LABELS[axis]} score {score:g}/100 is {gap:g} points under the target {target:g} (gap between 0 and {CRITICAL_GAP} → needs refinement)."
        elif severity == "surplus":
            trigger = f"{AXIS_LABELS[axis]} score {score:g}/100 exceeds the target {target:g} by {-gap:g} points (≥ {SURPLUS_MARGIN} → surplus)."
        else:
            trigger = f"{AXIS_LABELS[axis]} score {score:g}/100 meets the target {target:g}."
        if floor_breach:
            trigger += f" Also {floor_breach}."
        axes.append({"axis": axis, "label": AXIS_LABELS[axis], "score": score, "target": target, "gap": gap,
                     "severity": severity, "floor_breach": floor_breach, "trigger": trigger})

    scores = [a["score"] for a in axes]
    overall = round(sum(scores) / len(scores), 1)
    deficits = [a for a in axes if a["gap"] > 0]
    critical = [a for a in axes if a["severity"] == "critical"]
    critical_domain = max(deficits, key=lambda a: a["gap"]) if deficits else None
    strongest = max(axes, key=lambda a: a["score"])

    if cgpa is not None and cgpa >= tier1_cgpa and not critical:
        tier = {"key": "tier1", "label": "Tier-1 / dream recruiters",
                "reason": f"CGPA {cgpa:g} ≥ {tier1_cgpa:g} and no critical skill gaps."}
    elif cgpa is not None and cgpa >= 7.0 and len(critical) <= 1:
        tier = {"key": "tier2", "label": "Tier-2 / mass & core recruiters",
                "reason": f"CGPA {cgpa:g} ≥ 7.0 with {len(critical)} critical gap(s)"
                          + ("" if cgpa >= tier1_cgpa else f"; Tier-1 needs CGPA ≥ {tier1_cgpa:g}") + "."}
    else:
        tier = {"key": "foundation", "label": "Foundation track",
                "reason": ("CGPA unavailable" if cgpa is None else f"CGPA {cgpa:g}")
                          + f" with {len(critical)} critical gap(s); build fundamentals before drives."}

    roadmap = []
    for a in sorted(deficits, key=lambda a: (-a["gap"])):
        item = REMEDIATION[a["axis"]]
        priority = 1 if a["severity"] == "critical" else 2
        roadmap.append({
            "priority": priority, "type": "remediation", "axis": a["axis"], "code": item["code"],
            "title": item["title"], "focus_modules": item["focus_modules"], "deliverables": item["deliverables"],
            "severity": a["severity"], "diagnostic_trigger": a["trigger"],
        })
    surplus = [a for a in axes if a["severity"] == "surplus"]
    if surplus:
        best = max(surplus, key=lambda a: a["score"] - a["target"])
        roadmap.append({
            "priority": 3, "type": "reinforcement", "axis": best["axis"],
            "code": f"{REINFORCEMENT['code_prefix']}-{best['axis'][:3].upper()}-01",
            "title": f"{REINFORCEMENT['title']}: {best['label']}", "focus_modules": [best["label"]],
            "deliverables": REINFORCEMENT["deliverables"], "severity": "surplus",
            "diagnostic_trigger": best["trigger"],
        })
    roadmap.sort(key=lambda r: (r["priority"], -next(a["gap"] for a in axes if a["axis"] == r["axis"])))

    return {
        "overall_competency": overall,
        "overall_target": target_default,
        "axes": axes,
        "critical_domain": critical_domain,
        "strongest_domain": strongest,
        "critical_count": len(critical),
        "deficit_count": len(deficits),
        "eligible_tier": tier,
        "roadmap": roadmap,
        "rules": {"critical_gap": CRITICAL_GAP, "surplus_margin": SURPLUS_MARGIN,
                  "skill_target": target_default, "technical_threshold": technical_threshold,
                  "aptitude_threshold": aptitude_threshold, "tier1_min_cgpa": tier1_cgpa},
    }
