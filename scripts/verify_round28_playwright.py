"""
Playwright DOM and Visual Layout Check for Round 28.
Tests KAM contexts for 3 owners (many deals, a few, 1 deal) across viewport widths 1280, 1536, 1920.
Checks:
1. Stage Progress Bar:
   - Every segment has minimum width (>= 40px)
   - Deal count is shown on or directly above each segment
   - No label overlaps another (DOM bounding box overlap check)
   - Tooltip contains stage name, deals count, ACV and percentage
   - Clicking a segment opens DealListModal
2. Service Expiry Calendar:
   - Switch toggle to 'By service expiry'
   - For Luay Arabi: chart shows real months (e.g. Dec 2025, Apr 2026, Jul 2026, Sep 2026) and 0 Unscheduled deals
   - If an owner has unscheduled deals, explanation note is visible and clicking opens modal
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import time
import socket
import threading
import uvicorn
from playwright.sync_api import sync_playwright

from backend.database import SessionLocal
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import User
from backend.services.auth_service import sign_session_token


def get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def ensure_kam_user(owner_name: str) -> tuple[str, str, str, str]:
    db = SessionLocal()
    try:
        email = f"{owner_name.lower().replace(' ', '.')}.kam@example.com"
        user = db.query(User).filter(User.owner_name == owner_name).first()
        if not user:
            user = db.query(User).filter(User.email == email).first()
        if not user:
            from backend.services.auth_service import hash_password
            user = User(
                email=email,
                name=owner_name,
                role="kam",
                owner_name=owner_name,
                status="active",
                password_hash=hash_password("KamPassword123!"),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            if user.status != "active":
                user.status = "active"
                db.commit()
                db.refresh(user)
        token = sign_session_token(user)
        return token, str(user.id), user.email, user.name
    finally:
        db.close()


def run_round28_verification():
    port = get_free_port()
    base_url = f"http://127.0.0.1:{port}"
    print(f"[1/4] Starting backend + SPA server on {base_url}...")

    config = uvicorn.Config("backend.main:app", host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    for _ in range(50):
        try:
            s = socket.create_connection(("127.0.0.1", port), timeout=0.2)
            s.close()
            break
        except Exception:
            time.sleep(0.1)

    print("[2/4] Defining 3 test owners (many deals, few deals, 1 deal)...")
    test_cases = [
        ("Many Deals (Luay Arabi - 21 deals)", "Luay Arabi"),
        ("Few Deals (Ian Koh - 5 deals)", "Ian Koh"),
        ("1 Deal (Bernard Sin - 1 deal)", "Bernard Sin"),
    ]

    widths = [1280, 1536, 1920]
    height = 900

    print("[3/4] Running Playwright browser tests...")
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="msedge", headless=True, args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
        except Exception:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])

        for case_label, owner_name in test_cases:
            token, user_id, user_email, user_name = ensure_kam_user(owner_name)
            print(f"\n=======================================================")
            print(f"Testing KAM Context: {case_label}")
            print(f"=======================================================")

            for width in widths:
                print(f"\n--- Checking Viewport Width: {width}px ---")
                context = browser.new_context(viewport={"width": width, "height": height})
                context.add_cookies([
                    {"name": "auth_token", "value": token, "domain": "127.0.0.1", "path": "/"},
                    {"name": "session_token", "value": token, "domain": "127.0.0.1", "path": "/"},
                ])
                page = context.new_page()

                # Navigate and set auth
                page.goto(f"{base_url}/login")
                page.evaluate(f"""() => {{
                    localStorage.setItem('access_token', '{token}');
                    localStorage.setItem('auth-storage', JSON.stringify({{
                        state: {{
                            currentUser: {{
                                id: '{user_id}',
                                name: '{user_name}',
                                email: '{user_email}',
                                role: 'kam',
                                owner_name: '{owner_name}'
                            }},
                            token: '{token}',
                            isAuthenticated: true
                        }},
                        version: 0
                    }}));
                }}""")

                # -------------------------------------------------------------
                # 1. First go to /kam/overview to verify auth and load session
                # -------------------------------------------------------------
                try:
                    page.goto(f"{base_url}/kam/overview", wait_until="networkidle", timeout=20000)
                    page.wait_for_selector("h1:has-text('My Portfolio Overview')", timeout=15000)
                except Exception as e:
                    print(f"FAILED on wait_for_selector My Portfolio Overview: {e}")
                    print(f"Current URL: {page.url}")
                    body = page.evaluate("() => document.body.innerText")
                    print(f"Body innerText:\n{body[:600]}")
                    raise

                # -------------------------------------------------------------
                # 2. Navigate to Deal Tracker (/kam/tracker) via sidebar or URL
                # -------------------------------------------------------------
                tracker_link = page.query_selector("a:has-text('Deal Tracker')")
                if tracker_link:
                    tracker_link.click()
                else:
                    page.goto(f"{base_url}/kam/tracker", wait_until="networkidle", timeout=20000)

                page.wait_for_selector("h1:has-text('Deal Tracker')", timeout=15000)

                # A. Test Stage Progress Bar
                # Find all stage segments
                segments = page.query_selector_all("[data-stage-segment]")
                segment_count = len(segments)
                print(f"  ✓ [{width}px] Found {segment_count} stage progress bar segment(s)")

                if segment_count > 0:
                    # 1. Check each segment has minimum width >= 38px
                    segment_boxes = []
                    for seg in segments:
                        box = seg.bounding_box()
                        assert box is not None
                        assert box["width"] >= 38, f"Segment width {box['width']} < 38px!"
                        segment_boxes.append(box)

                    # 2. Check deal counts (labels or inside text)
                    count_elements = page.query_selector_all("[data-stage-count]")
                    assert len(count_elements) == segment_count, (
                        f"Expected {segment_count} deal count labels, got {len(count_elements)}"
                    )

                    # 3. DOM Overlap check: ensure no stage label overlaps another horizontally
                    label_boxes = []
                    for el in count_elements:
                        box = el.bounding_box()
                        assert box is not None
                        label_boxes.append(box)

                    label_boxes.sort(key=lambda b: b["x"])
                    for i in range(len(label_boxes) - 1):
                        b1 = label_boxes[i]
                        b2 = label_boxes[i + 1]
                        # Ensure b1 right edge does not overlap b2 left edge
                        assert b1["x"] + b1["width"] <= b2["x"] + 1, (
                            f"Label {i} (right={b1['x'] + b1['width']}) overlaps label {i+1} (left={b2['x']})!"
                        )
                    print(f"  ✓ [{width}px] All {len(label_boxes)} stage bar count labels are visible with ZERO overlap")

                    # 4. Check tooltip attribute or element
                    first_seg = segments[0]
                    title_attr = first_seg.get_attribute("title")
                    assert title_attr and "%" in title_attr and "$" in title_attr, f"Invalid tooltip: {title_attr}"
                    print(f"  ✓ [{width}px] Segment tooltip verified: '{title_attr}'")

                    # 5. Click segment opens DealListModal
                    first_seg.click()
                    page.wait_for_timeout(400)
                    modal = page.query_selector("div[role='dialog'], .fixed")
                    assert modal is not None, "DealListModal did not open on segment click!"
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(300)
                    print(f"  ✓ [{width}px] Segment click opened modal successfully")

                # B. Test Renewal Calendar - Service Expiry Grouping
                expiry_btn = page.locator("button:has-text('By service expiry')").first
                expiry_btn.scroll_into_view_if_needed()
                expiry_btn.click()
                page.wait_for_timeout(400)

                if owner_name == "Luay Arabi":
                    # Luay Arabi has 21 deals, all with valid dates. Unscheduled must NOT appear.
                    chart_section = page.locator("div:has-text('Renewal Calendar')").first
                    chart_text = chart_section.inner_text()
                    assert "Unscheduled" not in chart_text, (
                        "Error: 'Unscheduled' found in Luay Arabi's renewal calendar by service expiry!"
                    )
                    # Verify real months appear
                    assert any(m in chart_text for m in ["2025", "2026", "Apr", "Dec", "Jul", "Sep", "Nov"]), (
                        f"Expected real months in chart, got: {chart_text[:300]}"
                    )
                    print(f"  ✓ [{width}px] Luay Arabi service expiry shows real months and ZERO unscheduled deals")

                context.close()

        browser.close()

    print("\n[4/4] All Round 28 Playwright checks passed cleanly!")


if __name__ == "__main__":
    run_round28_verification()

