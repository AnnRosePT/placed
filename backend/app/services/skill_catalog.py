"""Static remediation catalog used by the skill-gap rule engine."""
from __future__ import annotations

AXIS_LABELS = {
    "dsa": "Data Structures & Algorithms",
    "system_design": "System Design & Architecture",
    "core_cs": "Core CS (OS / DBMS / Networks)",
    "aptitude": "Quantitative Aptitude",
    "communication": "Verbal & Communication",
}

REMEDIATION = {
    "dsa": {
        "code": "REM-DSA-01",
        "title": "DSA & Problem-Solving Intensive",
        "focus_modules": ["Arrays, hashing and two-pointer patterns", "Recursion, backtracking and dynamic programming",
                          "Trees, graphs, BFS/DFS and shortest paths"],
        "deliverables": ["Solve 40 graded practice problems across the three modules",
                         "Clear two timed coding mocks at or above the target score"],
    },
    "system_design": {
        "code": "REM-SYS-01",
        "title": "Object-Oriented & System Design Practice",
        "focus_modules": ["OOP and SOLID principles", "REST API and schema design", "Caching, indexing and scaling basics"],
        "deliverables": ["Build and document one modular service with a database schema",
                         "Present one design review to a faculty mentor"],
    },
    "core_cs": {
        "code": "REM-CCS-01",
        "title": "Core CS Fundamentals Revision",
        "focus_modules": ["Operating systems: processes, scheduling, memory", "DBMS: normalisation, SQL, transactions",
                          "Computer networks: TCP/IP, HTTP, DNS"],
        "deliverables": ["Complete three topic quizzes at or above the target score",
                         "Write 25 SQL queries against a sample schema"],
    },
    "aptitude": {
        "code": "REM-APT-01",
        "title": "Quantitative & Logical Aptitude Sprint",
        "focus_modules": ["Arithmetic: percentages, ratios, time-speed-work", "Logical reasoning and puzzles",
                          "Data interpretation under time limits"],
        "deliverables": ["Attempt 10 sectional timed tests", "Reach the target score on a full-length aptitude mock"],
    },
    "communication": {
        "code": "REM-COM-01",
        "title": "Communication & Interview Readiness",
        "focus_modules": ["Group discussion practice", "STAR-method answers for HR rounds", "Email and written communication"],
        "deliverables": ["Take part in three group discussions", "Complete two recorded mock HR interviews"],
    },
}

REINFORCEMENT = {
    "code_prefix": "ADV",
    "title": "Strength Reinforcement",
    "deliverables": ["Mentor one peer in this area", "Showcase this strength in resume and interview answers"],
}
