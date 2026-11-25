#!/usr/bin/env python3
"""
Seed Test Accounts for Local Development & Testing (Round 19).
Creates 1 management user and 2 KAM users linked to real opportunity owner names in the database.
Generates and displays one-time invite links.

Safety Guarantees:
- Refuses to run if APP_ENV or ENV is production/prod.
- Requires explicit --confirm-local flag.
- Never touches renewals.db unless specifically passed with --db and --confirm-local.
- Never prints or stores the admin password.
"""
from __future__ import annotations

import argparse
import os
import sys

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)


def seed_test_users():
    parser = argparse.ArgumentParser(description="Seed test users for local testing.")
    parser.add_argument(
        "--confirm-local",
        action="store_true",
        help="Confirmation that this is a local development environment.",
    )
    parser.add_argument(
        "--db",
        type=str,
        default="",
        help="Path to SQLite database file. By default creates and uses a throwaway copy.",
    )
    args = parser.parse_args()

    # 1. Environment Safety Check
    env_name = (os.environ.get("APP_ENV") or os.environ.get("ENV") or "development").strip().lower()
    if env_name in ("production", "prod"):
        print("[ERROR] Refusing to run in production environment (APP_ENV/ENV is production).", file=sys.stderr)
        sys.exit(1)

    if not args.confirm_local:
        print("[ERROR] Safety check: You must provide the --confirm-local flag to seed test users.", file=sys.stderr)
        sys.exit(1)

    # 2. Database connection setup
    db_target = args.db.strip()
    if db_target:
        if "renewals.db" in db_target.lower():
            print("[INFO] Target database explicitly specified as renewals.db with --confirm-local.")
        os.environ["DATABASE_URL"] = f"sqlite:///{os.path.abspath(db_target)}"
    else:
        # If no DB specified, use a throwaway test database
        throwaway_path = os.path.abspath(os.path.join(ROOT_DIR, "throwaway_seed_test.db"))
        print(f"[INFO] No --db specified. Using throwaway database: {throwaway_path}")
        os.environ["DATABASE_URL"] = f"sqlite:///{throwaway_path}"

    from backend.database import SessionLocal, engine, Base
    from backend.models.user import User, UserAlias
    from backend.models.opportunity import Opportunity
    from backend.models.snapshot import UploadSnapshot
    from backend.services.auth_service import create_user_token, ensure_default_accounts

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # Ensure default accounts exist
        ensure_default_accounts(db)

        # 3. Find 2 real opportunity owner names
        owners_query = (
            db.query(Opportunity.opportunity_owner)
            .filter(Opportunity.opportunity_owner != None, Opportunity.opportunity_owner != "")
            .distinct()
            .limit(10)
            .all()
        )
        real_owners = [o[0].strip() for o in owners_query if o[0] and o[0].strip()]
        if len(real_owners) < 2:
            real_owners = ["Raphael Roale", "Esteban Aguerre"]

        owner_1 = real_owners[0]
        owner_2 = real_owners[1]

        print(f"[INFO] Linking test KAM users to discovered opportunity owners: '{owner_1}' and '{owner_2}'")

        # 4. Create Management User
        mgmt_email = "mgmt_test@mobileum.com"
        mgmt_user = db.query(User).filter(User.email == mgmt_email).first()
        if not mgmt_user:
            mgmt_user = User(
                name="Test Management",
                email=mgmt_email,
                role="management",
                status="invited",
                is_owner=False,
                must_change_password=True,
            )
            db.add(mgmt_user)
            db.commit()
            db.refresh(mgmt_user)

        raw_mgmt_token, _ = create_user_token(db, mgmt_user, token_type="invite", expire_hours=72)

        # 5. Create KAM 1 User
        kam1_email = "kam1_test@mobileum.com"
        kam1_user = db.query(User).filter(User.email == kam1_email).first()
        if not kam1_user:
            kam1_user = User(
                name=owner_1,
                email=kam1_email,
                role="kam",
                owner_name=owner_1,
                status="invited",
                is_owner=False,
                must_change_password=True,
            )
            db.add(kam1_user)
            db.commit()
            db.refresh(kam1_user)

        raw_kam1_token, _ = create_user_token(db, kam1_user, token_type="invite", expire_hours=72)

        # 6. Create KAM 2 User
        kam2_email = "kam2_test@mobileum.com"
        kam2_user = db.query(User).filter(User.email == kam2_email).first()
        if not kam2_user:
            kam2_user = User(
                name=owner_2,
                email=kam2_email,
                role="kam",
                owner_name=owner_2,
                status="invited",
                is_owner=False,
                must_change_password=True,
            )
            db.add(kam2_user)
            db.commit()
            db.refresh(kam2_user)

        raw_kam2_token, _ = create_user_token(db, kam2_user, token_type="invite", expire_hours=72)

        base_url = "http://localhost:5173"

        print("\n" + "=" * 70)
        print("  MOBILEUM HORIZON — LOCAL TEST ACCOUNTS SEEDED SUCCESSFULLY")
        print("=" * 70)
        print("1. Management User:")
        print(f"   Email:       {mgmt_email}")
        print(f"   Role:        management (views all data, sends inquiries, adds custom columns/comments)")
        print(f"   Invite Link: {base_url}/invite/{raw_mgmt_token}")
        print("-" * 70)
        print(f"2. KAM User 1 (Linked to: {owner_1}):")
        print(f"   Email:       {kam1_email}")
        print(f"   Role:        kam (sees strictly own deals for '{owner_1}')")
        print(f"   Invite Link: {base_url}/invite/{raw_kam1_token}")
        print("-" * 70)
        print(f"3. KAM User 2 (Linked to: {owner_2}):")
        print(f"   Email:       {kam2_email}")
        print(f"   Role:        kam (sees strictly own deals for '{owner_2}')")
        print(f"   Invite Link: {base_url}/invite/{raw_kam2_token}")
        print("=" * 70 + "\n")

    finally:
        db.close()


if __name__ == "__main__":
    seed_test_users()

