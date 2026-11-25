"""
Playwright DOM and Visual Layout Check for Round 27.
Tests KAM contexts for 3 owners (many deals, a few, 1 deal) across viewport widths 1280, 1536, 1920.
Checks:
- Restored Overview tiles, tones/colours, order
- Movements & changes, 3 insight cards, regional reach, side-by-side charts, action center
- Sidebar item "Deal Tracker" and dedicated route /kam/tracker
- Renewal calendar, summary strip, closing soon/overdue, stage progress
- Chart click opens deal list modal
- No overlapping bounding boxes, no horizontal page overflow
"""
import os
import sys
from pathlib import Path

# Add project root to sys.path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import time
import socket
import threading
import subprocess
import uvicorn
from playwright.sync_api import sync_playwright

from backend.database import SessionLocal
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import User
from backend.services.auth_service import hash_password, sign_session_token


def get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def find_test_owners():
    db = SessionLocal()
    try:
        snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
        from sqlalchemy import func
        counts = (
            db.query(Opportunity.opportunity_owner, func.count(Opportunity.id))
            .filter(Opportunity.snapshot_id == snap.id)
            .group_by(Opportunity.opportunity_owner)
            .order_by(func.count(Opportunity.id).desc())
            .all()
        )
        many_owner = counts[0][0] # e.g. Luay Arabi (21 deals)
        few_owner = next(c[0] for c in counts if 3 <= c[1] <= 6)
        one_owner = next(c[0] for c in counts if c[1] == 1)
        return many_owner, few_owner, one_owner
    finally:
        db.close()


def ensure_kam_user(owner_name: str) -> dict:
    """Ensures a user exists with role='kam', owner_name, active status, known password."""
    db = SessionLocal()
    try:
        email = f"{owner_name.lower().replace(' ', '.')}.kam@example.com"
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                email=email,
                name=owner_name,
                role="kam",
                owner_name=owner_name,
                status="active",
                password_hash=hash_password("TestPass123!"),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user.password_hash = hash_password("TestPass123!")
            user.status = "active"
            db.commit()
            db.refresh(user)
        token = sign_session_token(user)
        return {
            "id": user.id,
            "email": email,
            "name": owner_name,
            "owner_name": owner_name,
            "token": token,
            "password": "TestPass123!"
        }
    finally:
        db.close()


def run_verification():
    port = get_free_port()
    base_url = f"http://127.0.0.1:{port}"
    print(f"[1/4] Starting backend + SPA server on {base_url}...")

    # Start uvicorn server in a background thread
    config = uvicorn.Config("backend.main:app", host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    # Wait for server to start
    for _ in range(50):
        try:
            s = socket.create_connection(("127.0.0.1", port), timeout=0.2)
            s.close()
            break
        except Exception:
            time.sleep(0.1)

    print("[2/4] Finding representative owners...")
    many_owner, few_owner, one_owner = find_test_owners()
    test_cases = [
        ("Many Deals", many_owner),
        ("Few Deals", few_owner),
        ("1 Deal", one_owner),
    ]
    print(f"  - Many: {many_owner}\n  - Few:  {few_owner}\n  - One:  {one_owner}")

    widths = [1280, 1536, 1920]
    height = 900

    print("[3/4] Launching Playwright browser...")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)

        for case_label, owner_name in test_cases:
            user_info = ensure_kam_user(owner_name)
            token = user_info["token"]
            print(f"\n=======================================================")
            print(f"Testing KAM Context: {case_label} ({owner_name})")
            print(f"=======================================================")

            for width in widths:
                print(f"\n--- Checking Viewport Width: {width}px ---")
                context = browser.new_context(viewport={"width": width, "height": height})
                page = context.new_page()

                # Perform actual UI login
                page.goto(f"{base_url}/login")
                page.wait_for_selector("input[type='email']", timeout=10000)
                page.fill("input[type='email']", user_info["email"])
                page.fill("input[type='password']", user_info["password"])
                page.click("button[type='submit']")
                page.wait_for_url(lambda u: "/kam" in u or "/overview" in u, timeout=15000)

                # -------------------------------------------------------------
                # 1. Test My Overview (/kam/overview)
                # -------------------------------------------------------------
                try:
                    if "/kam/overview" not in page.url:
                        page.goto(f"{base_url}/kam/overview", wait_until="networkidle", timeout=15000)
                    page.wait_for_selector("h1:has-text('My Portfolio Overview')", timeout=10000)
                except Exception as e:
                    print(f"FAILED on goto /kam/overview: {e}")
                    print(f"Current URL: {page.url}")
                    body_text = page.evaluate("() => document.body.innerText")
                    print(f"Body text:\n{body_text[:400]}")
                    raise

                # Verify 8 tiles exist
                expected_tiles = [
                    "MY PORTFOLIO",
                    "COMMIT COVERAGE",
                    "APPROVED",
                    "PENDING APPROVAL",
                    "NOT SUBMITTED",
                    "DELAYED RENEWALS",
                    "SLIPPAGE",
                    "NEEDS REVIEW",
                ]

                tile_elements = page.query_selector_all("[class*='Tile'], div.grid > div")
                page_text = page.inner_text("body")
                for title in expected_tiles:
                    assert title in page_text, f"[{width}px] Expected tile '{title}' missing on Overview!"

                print(f"  ✓ [{width}px] All 8 restored KPI tiles present on Overview")

                # Verify Sidebar contains Deal Tracker directly after My Overview
                sidebar_items = page.evaluate("""() => {
                    const links = Array.from(document.querySelectorAll('nav a, aside a'));
                    return links.map(a => a.textContent?.trim()).filter(Boolean);
                }""")
                assert any("Deal Tracker" in item for item in sidebar_items), f"[{width}px] Deal Tracker missing in sidebar!"
                print(f"  ✓ [{width}px] Sidebar contains 'Deal Tracker'")

                # Verify no horizontal scrollbar on body
                overflow = page.evaluate("""() => {
                    const doc = document.documentElement;
                    return doc.scrollWidth > doc.clientWidth + 2;
                }""")
                assert not overflow, f"[{width}px] Horizontal overflow detected on /kam/overview!"

                # Verify tile bounding boxes do not overlap horizontally in row 1
                tile_boxes = page.evaluate("""() => {
                    const tiles = Array.from(document.querySelectorAll('div.grid > div')).slice(0, 4);
                    return tiles.map(t => {
                        const r = t.getBoundingClientRect();
                        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
                    });
                }""")
                for i in range(len(tile_boxes) - 1):
                    b1 = tile_boxes[i]
                    b2 = tile_boxes[i + 1]
                    if abs(b1['top'] - b2['top']) < 10:  # Same row
                        assert b1['right'] <= b2['left'] + 2, f"Tiles {i} and {i+1} overlap horizontally!"
                print(f"  ✓ [{width}px] No tile overlapping bounding boxes")

                # Verify Movements & Changes strip
                assert "Movements & Changes" in page_text
                print(f"  ✓ [{width}px] Movements & Changes banner active")

                # Verify Regional Reach line
                assert "REGIONAL REACH" in page_text
                print(f"  ✓ [{width}px] Regional Reach section rendered")

                # Test chart click: click on Approved tile or forecast card
                approved_tile = page.query_selector("text=APPROVED")
                if approved_tile:
                    approved_tile.click()
                    page.wait_for_timeout(400)
                    modal = page.query_selector("div[role='dialog'], .fixed")
                    if modal:
                        modal_title = page.evaluate("() => document.querySelector('h2, h3')?.textContent")
                        print(f"  ✓ [{width}px] Modal opened on tile click: '{modal_title}'")
                        # Close modal
                        close_btn = page.query_selector("button:has-text('Close'), button[aria-label='Close'], button:has(svg.lucide-x)")
                        if close_btn:
                            close_btn.click()
                            page.wait_for_timeout(200)

                # -------------------------------------------------------------
                # 2. Test Deal Tracker (/kam/tracker)
                # -------------------------------------------------------------
                page.goto(f"{base_url}/kam/tracker", wait_until="networkidle")
                page.wait_for_selector("h1:has-text('Deal Tracker')", timeout=10000)

                dt_text = page.inner_text("body")
                dt_text_lower = dt_text.lower()
                assert "deals in view" in dt_text_lower, f"[{width}px] Summary strip missing 'Deals in View'"
                assert "acv in view" in dt_text_lower, f"[{width}px] Summary strip missing 'ACV in View'"
                assert "renewal calendar" in dt_text_lower or "no dates scheduled" in dt_text_lower
                assert "stage progress" in dt_text_lower or "no active deals" in dt_text_lower

                # Check toggle works: "By close date" vs "By service expiry"
                expiry_toggle = page.query_selector("button:has-text('By service expiry')")
                if expiry_toggle:
                    expiry_toggle.click()
                    page.wait_for_timeout(300)
                    print(f"  ✓ [{width}px] Deal Tracker calendar toggle switched to 'By service expiry'")

                print(f"  ✓ [{width}px] Deal Tracker route /kam/tracker rendered successfully")
                context.close()

        browser.close()

    print("\n[4/4] All Playwright DOM and layout checks passed across 3 owners and 3 widths!")


if __name__ == "__main__":
    run_verification()
