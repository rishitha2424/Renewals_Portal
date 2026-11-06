"""
Guard test (Item 8) to ensure nothing in the application code depends on
hardcoded dates, quarters, years, or numbers.

Scans:
- backend/services
- backend/routers
- frontend/src

Excluding tests and dev_only directories.

Fails if it finds:
- Literal quarter like Q[1-4]-20\\d\\d or FY2\\d
- Numbers: 3093, 451999230, 40068990, 41115061
- ISO date literal: 2026-

Allow-listed only:
- Quarter regex in the ScopeService helper docstrings (backend/services/scopes.py)
"""
import os
import re
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]

TARGET_DIRS = [
    ROOT / "backend" / "services",
    ROOT / "backend" / "routers",
    ROOT / "frontend" / "src",
]

PATTERNS = {
    "quarter": re.compile(r"Q[1-4]-20\d\d"),
    "fiscal_year": re.compile(r"FY2\d"),
    "num_3093": re.compile(r"\b3093\b"),
    "num_451999230": re.compile(r"451999230"),
    "num_40068990": re.compile(r"40068990"),
    "num_41115061": re.compile(r"41115061"),
    "iso_date_2026": re.compile(r"2026-"),
}

VALID_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx"}


def is_excluded_path(p: Path) -> bool:
    parts = p.parts
    return (
        "tests" in parts
        or "__tests__" in parts
        or "dev_only" in parts
        or any(part.endswith(".test.ts") or part.endswith(".test.tsx") for part in parts)
    )


def is_allowlisted(rel_path: str, line: str) -> bool:
    # Allow-list only the quarter regex in ScopeService helper docstrings
    norm_path = rel_path.replace("\\", "/")
    if norm_path == "backend/services/scopes.py":
        # Allow docstrings referencing helper pattern or regex
        if "ScopeService" in line or "r\"^Q([1-4])-(\\d{4})$\"" in line or "Q[1-4]" in line:
            return True
    return False


def test_no_hardcoding():
    violations = []

    for target in TARGET_DIRS:
        if not target.exists():
            continue
        for root, dirs, files in os.walk(target):
            # Prune excluded directories
            dirs[:] = [d for d in dirs if d not in ("tests", "__tests__", "dev_only", "node_modules")]
            for f in files:
                file_path = Path(root) / f
                if file_path.suffix not in VALID_EXTENSIONS:
                    continue
                if is_excluded_path(file_path):
                    continue

                rel_path = str(file_path.relative_to(ROOT))
                try:
                    content = file_path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue

                for line_no, line in enumerate(content.splitlines(), start=1):
                    if is_allowlisted(rel_path, line):
                        continue

                    for pat_name, pat in PATTERNS.items():
                        if pat.search(line):
                            violations.append(
                                f"{rel_path}:{line_no} [{pat_name}] -> {line.strip()}"
                            )

    assert not violations, f"Found {len(violations)} hardcoded values:\n" + "\n".join(violations[:50])


ASSERT_3DIGIT_NUMBER = re.compile(r"assert\s+.*==\s*\d{3,}(?:\.\d+)?")
ASSERT_3DIGIT_NUMBER_REV = re.compile(r"assert\s+\d{3,}(?:\.\d+)?\s*==")


def test_no_hardcoded_number_assertions_in_backend_tests():
    """
    Scans backend/tests for assertions with hardcoded numbers of 3+ digits (e.g. == 193, == 206).
    Expected values must be computed dynamically with pandas from fixture Excel or derived from len()/sum().
    Allow-listed:
    - HTTP status_code assertions (e.g. status_code == 200, status_code == 409)
    - Comment lines
    """
    tests_dir = ROOT / "backend" / "tests"
    assert tests_dir.exists()

    violations = []

    for file_path in tests_dir.glob("**/*.py"):
        if file_path.name == "test_no_hardcoding.py":
            continue

        rel_path = str(file_path.relative_to(ROOT)).replace("\\", "/")
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        for line_no, line in enumerate(content.splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue

            if ASSERT_3DIGIT_NUMBER.search(line) or ASSERT_3DIGIT_NUMBER_REV.search(line):
                # Allow-listed: status_code assertions (e.g. status_code == 200, status_code == 409)
                if "status_code" in line:
                    continue

                violations.append(
                    f"{rel_path}:{line_no} -> {stripped}"
                )

    assert not violations, (
        f"Found {len(violations)} hardcoded number assertions (3+ digits) in backend/tests:\n"
        + "\n".join(violations[:50])
    )
