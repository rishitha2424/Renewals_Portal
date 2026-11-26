import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

from backend.database import Base
from backend.models import User, UserAlias, UserToken, DealMessage, EmailOutbox, Opportunity, UploadSnapshot
from backend.services.auth_service import (
    hash_password,
    verify_password,
    validate_password_strength,
    create_user_token,
    verify_user_token,
    consume_user_token,
    sign_session_token,
    decode_session_token,
    ensure_default_accounts,
)
from backend.routers.admin_users import check_last_admin_or_owner_protection
from backend.services.mail_service import MailService
from backend.services.context import UserContext
from backend.services.scopes import ScopeService, FilterSpec


@pytest.fixture
def test_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_password_hashing_and_verification():
    raw = "MobileumSecret2026!"
    hashed = hash_password(raw)
    assert hashed != raw
    assert verify_password(raw, hashed) is True
    assert verify_password("WrongPassword", hashed) is False

    ok, _ = validate_password_strength("Short1")
    assert ok is False

    ok, _ = validate_password_strength("ValidPassw0rd")
    assert ok is True


def test_seed_default_accounts_and_owner_protection(test_db):
    accounts = ensure_default_accounts(test_db)
    admin = accounts["admin"]
    mgmt = accounts["management"]

    assert admin.is_owner is True
    assert admin.role == "admin"
    assert admin.status == "active"

    assert mgmt.name == "Management"
    assert mgmt.role == "management"
    assert mgmt.is_owner is False

    # Owner cannot be deleted or disabled
    with pytest.raises(HTTPException) as exc:
        check_last_admin_or_owner_protection(test_db, admin, "delete")
    assert exc.value.status_code == 403
    assert "system owner" in exc.value.detail.lower()


def test_invite_and_reset_token_flow(test_db):
    user = User(
        name="Gabriel Camarena",
        email="gabriel@mobileum.com",
        role="kam",
        status="invited",
        owner_name="Gabriel Camarena",
    )
    test_db.add(user)
    test_db.commit()

    raw_token, token_obj = create_user_token(test_db, user, "invite", expire_hours=48)
    assert raw_token is not None
    assert token_obj.token_type == "invite"

    # Verify
    v_user, v_token, err = verify_user_token(test_db, raw_token, "invite")
    assert err == ""
    assert v_user.id == user.id

    # Consume
    consume_user_token(test_db, v_token)
    assert v_token.used_at is not None

    # Cannot verify again
    v2_user, _, err2 = verify_user_token(test_db, raw_token, "invite")
    assert v2_user is None
    assert "already been used" in err2


def test_session_token_signing_and_decoding(test_db):
    user = User(
        name="Admin User",
        email="admin@example.com",
        role="admin",
        status="active",
        is_owner=True,
    )
    test_db.add(user)
    test_db.commit()

    token = sign_session_token(user)
    assert token is not None

    decoded = decode_session_token(token)
    assert decoded is not None
    assert decoded["email"] == "admin@example.com"
    assert decoded["role"] == "admin"
    assert decoded["is_owner"] is True


def test_kam_data_isolation_with_scopes(test_db):
    snap = UploadSnapshot(snapshot_date=datetime.now().date(), label="Test Nov 22", is_active_today=True)
    test_db.add(snap)
    test_db.flush()

    opp1 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000Esteban1",
        opportunity_name="Esteban Renewal Deal",
        account_name="Telecom Argentina",
        sales_type="Renewals",
        is_deleted_or_lost=False,
        is_reconciliation_entry=False,
        forecast_category="Commit",
        forecast_acv_amount=50000.0,
        opportunity_owner="Esteban Aguerre",
        business_unit_primary="Roaming",
    )
    opp2 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000Deepak1",
        opportunity_name="Deepak Renewal Deal",
        account_name="Verizon",
        sales_type="Renewals",
        is_deleted_or_lost=False,
        is_reconciliation_entry=False,
        forecast_category="Commit",
        forecast_acv_amount=100000.0,
        opportunity_owner="Deepak Gulati",
        business_unit_primary="Roaming",
    )
    test_db.add_all([opp1, opp2])
    test_db.commit()

    # Esteban context
    esteban_ctx = UserContext(
        user_id="user_esteban",
        role="kam",
        owner_name="Esteban Aguerre",
        owner_aliases=["E. Aguerre"],
    )
    assert esteban_ctx.is_kam is True

    fs = FilterSpec(user_context=esteban_ctx, period="all")
    res = ScopeService.resolve(fs, snapshot=snap, as_of_date=snap.snapshot_date, db=test_db)

    opps = test_db.query(Opportunity).filter(
        Opportunity.snapshot_id == snap.id,
        *res.conditions
    ).all()

    # Esteban should only see opp1, NOT opp2
    opp_ids = [o.opportunity_id_18 for o in opps]
    assert "006Qp00000Esteban1" in opp_ids
    assert "006Qp00000Deepak1" not in opp_ids


def test_messaging_and_email_outbox(test_db):
    msg = DealMessage(
        deal_id="006Qp00000Esteban1",
        thread_id="thread_esteban_1",
        sender_id="admin_1",
        sender_name="Administrator",
        sender_role="admin",
        body="Please confirm if customer agreed to pricing.",
    )
    test_db.add(msg)
    test_db.commit()

    assert msg.id is not None
    assert msg.is_read is False

    item = MailService.queue_email(
        test_db,
        recipient_email="esteban@mobileum.com",
        subject="Action required on renewal",
        template_type="deal_message",
        body_html="<p>Test</p>",
    )
    assert item.id is not None
    assert "pending" in item.status or "sent" in item.status
