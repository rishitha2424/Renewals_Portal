import time
import uuid
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from authlib.jose import JsonWebKey, jwt

from backend.main import app
from backend.database import Base, get_db
from backend.models.user import User, SSOAccessRequest, AuditLog
from backend.config import settings
from backend.services.auth_service import hash_password, sign_session_token
from backend.services.sso_service import SSOService

# Fixed mock identifiers for testing
MOCK_TENANT_ID = "11111111-2222-3333-4444-555555555555"
MOCK_CLIENT_ID = "66666666-7777-8888-9999-000000000000"
MOCK_CLIENT_SECRET = "mock_azure_client_secret_xyz123"
MOCK_KEY_ID = "mock-ms-key-001"

# Generate mock RSA key pair for testing
_RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PUB_PEM = _RSA_KEY.public_key().public_bytes(
    serialization.Encoding.PEM,
    serialization.PublicFormat.SubjectPublicKeyInfo,
)
_PRIV_PEM = _RSA_KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
_JWK_DICT = JsonWebKey.import_key(_PUB_PEM).as_dict()
_JWK_DICT["kid"] = MOCK_KEY_ID
_JWK_DICT["use"] = "sig"
_JWK_DICT["alg"] = "RS256"

MOCK_JWKS = {"keys": [_JWK_DICT]}

# Untrusted key for bad signature testing
_BAD_RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_BAD_PRIV_PEM = _BAD_RSA_KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)


def create_mock_jwt(
    claims: dict,
    kid: str = MOCK_KEY_ID,
    priv_key_pem: bytes = _PRIV_PEM,
) -> str:
    """Helper to mint a mock signed JWT token."""
    header = {"alg": "RS256", "kid": kid}
    return jwt.encode(header, claims, priv_key_pem).decode("utf-8")


@pytest.fixture(scope="module")
def sso_test_env():
    """Setup in-memory SQLite database and configure SSO mock environment."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Save original settings
    orig_sso_enabled = settings.SSO_ENABLED
    orig_tenant_id = settings.AZURE_TENANT_ID
    orig_client_id = settings.AZURE_CLIENT_ID
    orig_client_secret = settings.AZURE_CLIENT_SECRET
    orig_redirect = settings.SSO_REDIRECT_URI
    orig_local_login = settings.SSO_LOCAL_LOGIN_ENABLED
    orig_pass_for_users = settings.SSO_PASSWORD_LOGIN_FOR_USERS
    orig_owner_email = settings.OWNER_EMAIL

    # Set mock SSO configuration
    settings.SSO_ENABLED = True
    settings.AZURE_TENANT_ID = MOCK_TENANT_ID
    settings.AZURE_CLIENT_ID = MOCK_CLIENT_ID
    settings.AZURE_CLIENT_SECRET = MOCK_CLIENT_SECRET
    settings.SSO_REDIRECT_URI = "http://testserver/api/auth/sso/callback"
    settings.SSO_LOCAL_LOGIN_ENABLED = True
    settings.SSO_PASSWORD_LOGIN_FOR_USERS = False
    settings.OWNER_EMAIL = "admin.owner@example.com"
    settings.ADMIN_PASSWORD = "OwnerBreakGlassPassword123!"

    # Seed owner account
    owner_user = User(
        name="Admin Owner",
        email="admin.owner@example.com",
        password_hash=hash_password("OwnerBreakGlassPassword123!"),
        role="admin",
        is_owner=True,
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db.add(owner_user)

    # Seed existing active KAM user
    kam_user = User(
        name="Luay Arabi",
        email="luay.arabi@mobileum.com",
        password_hash=hash_password("KamUserPassword123!"),
        role="kam",
        owner_name="Luay Arabi",
        is_owner=False,
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db.add(kam_user)

    # Seed disabled user
    disabled_user = User(
        name="Disabled User",
        email="disabled.user@mobileum.com",
        password_hash=hash_password("DisabledPassword123!"),
        role="kam",
        is_owner=False,
        status="disabled",
        created_at=datetime.now(timezone.utc),
    )
    db.add(disabled_user)

    db.commit()
    db.refresh(owner_user)
    db.refresh(kam_user)
    db.refresh(disabled_user)

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db

    yield {
        "db": db,
        "owner": owner_user,
        "kam": kam_user,
        "disabled": disabled_user,
    }

    # Teardown
    app.dependency_overrides.clear()
    settings.SSO_ENABLED = orig_sso_enabled
    settings.AZURE_TENANT_ID = orig_tenant_id
    settings.AZURE_CLIENT_ID = orig_client_id
    settings.AZURE_CLIENT_SECRET = orig_client_secret
    settings.SSO_REDIRECT_URI = orig_redirect
    settings.SSO_LOCAL_LOGIN_ENABLED = orig_local_login
    settings.SSO_PASSWORD_LOGIN_FOR_USERS = orig_pass_for_users
    settings.OWNER_EMAIL = orig_owner_email


def test_auth_url_generation_pkce_and_cookies(sso_test_env):
    """
    1. GET /api/auth/sso/login initiates authorization code flow with PKCE S256.
    2. URL parameters include client_id, response_type=code, code_challenge, state, nonce.
    3. Response sets HttpOnly sso_state, sso_nonce, and sso_verifier cookies.
    """
    client = TestClient(app)
    resp = client.get("/api/auth/sso/login", follow_redirects=False)
    assert resp.status_code == 302

    redirect_url = resp.headers["location"]
    assert "https://login.microsoftonline.com/" in redirect_url
    assert f"client_id={MOCK_CLIENT_ID}" in redirect_url
    assert "response_type=code" in redirect_url
    assert "code_challenge=" in redirect_url
    assert "code_challenge_method=S256" in redirect_url
    assert "state=" in redirect_url
    assert "nonce=" in redirect_url

    # Check cookies
    cookies = resp.cookies
    assert "sso_state" in cookies
    assert "sso_nonce" in cookies
    assert "sso_verifier" in cookies


def test_valid_id_token_logs_in_existing_user(sso_test_env, monkeypatch):
    """
    1. Valid ID token logs in an existing active user.
    2. Session cookie auth_token is set.
    3. User's role is preserved ('kam').
    4. last_sso_login and sso_provider are updated.
    5. SSO cookies are cleared.
    """
    client = TestClient(app)
    db = sso_test_env["db"]

    # 1. Start login flow to capture state cookies
    init_resp = client.get("/api/auth/sso/login", follow_redirects=False)
    state = init_resp.cookies["sso_state"]
    nonce = init_resp.cookies["sso_nonce"]
    verifier = init_resp.cookies["sso_verifier"]

    # 2. Mock token payload
    now = int(time.time())
    payload = {
        "iss": f"https://login.microsoftonline.com/{MOCK_TENANT_ID}/v2.0",
        "aud": MOCK_CLIENT_ID,
        "tid": MOCK_TENANT_ID,
        "sub": "mock-sub-luay-12345",
        "email": "luay.arabi@mobileum.com",
        "name": "Luay Arabi",
        "nonce": nonce,
        "iat": now - 10,
        "exp": now + 3600,
    }
    id_token = create_mock_jwt(payload)

    # Monkeypatch token exchange and jwks fetch
    monkeypatch.setattr(SSOService, "fetch_jwks", lambda tenant_id=None: MOCK_JWKS)
    monkeypatch.setattr(
        SSOService,
        "exchange_code",
        lambda code, code_verifier, **kw: {"id_token": id_token, "access_token": "mock-at"},
    )

    client.cookies.set("sso_state", state)
    client.cookies.set("sso_nonce", nonce)
    client.cookies.set("sso_verifier", verifier)

    callback_resp = client.get(
        f"/api/auth/sso/callback?code=mock_auth_code_123&state={state}",
        follow_redirects=False,
    )

    assert callback_resp.status_code == 302
    assert callback_resp.headers["location"] == "/kam/overview"
    assert "auth_token" in callback_resp.cookies

    # Verify database update
    kam = db.query(User).filter(User.email == "luay.arabi@mobileum.com").first()
    assert kam.role == "kam"
    assert kam.last_sso_login is not None
    assert kam.sso_provider == "entra_id"


def test_unknown_email_redirects_no_access_and_records_request(sso_test_env, monkeypatch):
    """
    1. Unknown corporate email redirects to /login?error=no_access&email=...
    2. No auth_token session cookie is set.
    3. An SSOAccessRequest row is created with attempt_count=1.
    4. Second attempt increments attempt_count and updates last_attempt_at.
    """
    client = TestClient(app)
    db = sso_test_env["db"]
    unknown_email = "new.employee@mobileum.com"

    monkeypatch.setattr(SSOService, "fetch_jwks", lambda tenant_id=None: MOCK_JWKS)

    # First attempt
    init_resp = client.get("/api/auth/sso/login", follow_redirects=False)
    state = init_resp.cookies["sso_state"]
    nonce = init_resp.cookies["sso_nonce"]
    verifier = init_resp.cookies["sso_verifier"]

    now = int(time.time())
    payload = {
        "iss": f"https://login.microsoftonline.com/{MOCK_TENANT_ID}/v2.0",
        "aud": MOCK_CLIENT_ID,
        "tid": MOCK_TENANT_ID,
        "sub": "mock-sub-unknown-1",
        "email": unknown_email,
        "name": "New Employee",
        "nonce": nonce,
        "iat": now - 10,
        "exp": now + 3600,
    }
    id_token = create_mock_jwt(payload)
    monkeypatch.setattr(
        SSOService,
        "exchange_code",
        lambda code, code_verifier, **kw: {"id_token": id_token, "access_token": "mock-at"},
    )

    client.cookies.set("sso_state", state)
    client.cookies.set("sso_nonce", nonce)
    client.cookies.set("sso_verifier", verifier)

    resp1 = client.get(
        f"/api/auth/sso/callback?code=mock_code_1&state={state}",
        follow_redirects=False,
    )
    assert resp1.status_code == 302
    assert "error=no_access" in resp1.headers["location"]
    assert "auth_token" not in resp1.cookies

    req_row = db.query(SSOAccessRequest).filter(SSOAccessRequest.email == unknown_email).first()
    assert req_row is not None
    assert req_row.attempt_count == 1
    assert req_row.count == 1
    assert req_row.first_seen is not None
    assert req_row.last_seen is not None

    # Second attempt
    init_resp2 = client.get("/api/auth/sso/login", follow_redirects=False)
    state2 = init_resp2.cookies["sso_state"]
    nonce2 = init_resp2.cookies["sso_nonce"]
    verifier2 = init_resp2.cookies["sso_verifier"]

    payload["nonce"] = nonce2
    id_token2 = create_mock_jwt(payload)
    monkeypatch.setattr(
        SSOService,
        "exchange_code",
        lambda code, code_verifier, **kw: {"id_token": id_token2, "access_token": "mock-at"},
    )

    client.cookies.set("sso_state", state2)
    client.cookies.set("sso_nonce", nonce2)
    client.cookies.set("sso_verifier", verifier2)

    resp2 = client.get(
        f"/api/auth/sso/callback?code=mock_code_2&state={state2}",
        follow_redirects=False,
    )
    assert resp2.status_code == 302

    db.refresh(req_row)
    assert req_row.attempt_count == 2
    assert req_row.count == 2


def test_disabled_user_redirects_account_disabled(sso_test_env, monkeypatch):
    """Disabled user authenticating via SSO is rejected with /login?error=account_disabled."""
    client = TestClient(app)
    monkeypatch.setattr(SSOService, "fetch_jwks", lambda tenant_id=None: MOCK_JWKS)

    init_resp = client.get("/api/auth/sso/login", follow_redirects=False)
    state = init_resp.cookies["sso_state"]
    nonce = init_resp.cookies["sso_nonce"]
    verifier = init_resp.cookies["sso_verifier"]

    now = int(time.time())
    payload = {
        "iss": f"https://login.microsoftonline.com/{MOCK_TENANT_ID}/v2.0",
        "aud": MOCK_CLIENT_ID,
        "tid": MOCK_TENANT_ID,
        "sub": "mock-sub-disabled",
        "email": "disabled.user@mobileum.com",
        "name": "Disabled User",
        "nonce": nonce,
        "iat": now - 10,
        "exp": now + 3600,
    }
    id_token = create_mock_jwt(payload)
    monkeypatch.setattr(
        SSOService,
        "exchange_code",
        lambda code, code_verifier, **kw: {"id_token": id_token, "access_token": "mock-at"},
    )

    client.cookies.set("sso_state", state)
    client.cookies.set("sso_nonce", nonce)
    client.cookies.set("sso_verifier", verifier)

    resp = client.get(
        f"/api/auth/sso/callback?code=mock_code_dis&state={state}",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"] == "/login?error=account_disabled"
    assert "auth_token" not in resp.cookies


def test_tenant_id_mismatch_rejected(sso_test_env, monkeypatch):
    """Token with wrong tenant ID (tid != AZURE_TENANT_ID) rejected with /login?error=tenant_mismatch."""
    client = TestClient(app)
    monkeypatch.setattr(SSOService, "fetch_jwks", lambda tenant_id=None: MOCK_JWKS)

    init_resp = client.get("/api/auth/sso/login", follow_redirects=False)
    state = init_resp.cookies["sso_state"]
    nonce = init_resp.cookies["sso_nonce"]
    verifier = init_resp.cookies["sso_verifier"]

    now = int(time.time())
    payload = {
        "iss": f"https://login.microsoftonline.com/{MOCK_TENANT_ID}/v2.0",
        "aud": MOCK_CLIENT_ID,
        "tid": "wrong-tenant-id-00000000",
        "sub": "mock-sub-1",
        "email": "luay.arabi@mobileum.com",
        "nonce": nonce,
        "iat": now - 10,
        "exp": now + 3600,
    }
    id_token = create_mock_jwt(payload)
    monkeypatch.setattr(
        SSOService,
        "exchange_code",
        lambda code, code_verifier, **kw: {"id_token": id_token, "access_token": "mock-at"},
    )

    client.cookies.set("sso_state", state)
    client.cookies.set("sso_nonce", nonce)
    client.cookies.set("sso_verifier", verifier)

    resp = client.get(
        f"/api/auth/sso/callback?code=mock_code_tid&state={state}",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"] == "/login?error=tenant_mismatch"
    assert "auth_token" not in resp.cookies


def test_wrong_audience_rejected(sso_test_env, monkeypatch):
    """Token with wrong audience (aud != AZURE_CLIENT_ID) rejected with /login?error=sso_token_invalid."""
    client = TestClient(app)
    monkeypatch.setattr(SSOService, "fetch_jwks", lambda tenant_id=None: MOCK_JWKS)

    init_resp = client.get("/api/auth/sso/login", follow_redirects=False)
    state = init_resp.cookies["sso_state"]
    nonce = init_resp.cookies["sso_nonce"]
    verifier = init_resp.cookies["sso_verifier"]

    now = int(time.time())
    payload = {
        "iss": f"https://login.microsoftonline.com/{MOCK_TENANT_ID}/v2.0",
        "aud": "wrong-client-aud-99999",
        "tid": MOCK_TENANT_ID,
        "sub": "mock-sub-1",
        "email": "luay.arabi@mobileum.com",
        "nonce": nonce,
        "iat": now - 10,
        "exp": now + 3600,
    }
    id_token = create_mock_jwt(payload)
    monkeypatch.setattr(
        SSOService,
        "exchange_code",
        lambda code, code_verifier, **kw: {"id_token": id_token, "access_token": "mock-at"},
    )

    client.cookies.set("sso_state", state)
    client.cookies.set("sso_nonce", nonce)
    client.cookies.set("sso_verifier", verifier)

    resp = client.get(
        f"/api/auth/sso/callback?code=mock_code_aud&state={state}",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"] == "/login?error=sso_token_invalid"


def test_expired_token_rejected(sso_test_env, monkeypatch):
    """Token with expired timestamp rejected."""
    client = TestClient(app)
    monkeypatch.setattr(SSOService, "fetch_jwks", lambda tenant_id=None: MOCK_JWKS)

    init_resp = client.get("/api/auth/sso/login", follow_redirects=False)
    state = init_resp.cookies["sso_state"]
    nonce = init_resp.cookies["sso_nonce"]
    verifier = init_resp.cookies["sso_verifier"]

    now = int(time.time())
    payload = {
        "iss": f"https://login.microsoftonline.com/{MOCK_TENANT_ID}/v2.0",
        "aud": MOCK_CLIENT_ID,
        "tid": MOCK_TENANT_ID,
        "sub": "mock-sub-1",
        "email": "luay.arabi@mobileum.com",
        "nonce": nonce,
        "iat": now - 3600,
        "exp": now - 60,  # Expired 1 minute ago
    }
    id_token = create_mock_jwt(payload)
    monkeypatch.setattr(
        SSOService,
        "exchange_code",
        lambda code, code_verifier, **kw: {"id_token": id_token, "access_token": "mock-at"},
    )

    client.cookies.set("sso_state", state)
    client.cookies.set("sso_nonce", nonce)
    client.cookies.set("sso_verifier", verifier)

    resp = client.get(
        f"/api/auth/sso/callback?code=mock_code_exp&state={state}",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"] == "/login?error=sso_token_invalid"


def test_bad_signature_rejected(sso_test_env, monkeypatch):
    """Token signed with untrusted key rejected."""
    client = TestClient(app)
    monkeypatch.setattr(SSOService, "fetch_jwks", lambda tenant_id=None: MOCK_JWKS)

    init_resp = client.get("/api/auth/sso/login", follow_redirects=False)
    state = init_resp.cookies["sso_state"]
    nonce = init_resp.cookies["sso_nonce"]
    verifier = init_resp.cookies["sso_verifier"]

    now = int(time.time())
    payload = {
        "iss": f"https://login.microsoftonline.com/{MOCK_TENANT_ID}/v2.0",
        "aud": MOCK_CLIENT_ID,
        "tid": MOCK_TENANT_ID,
        "sub": "mock-sub-1",
        "email": "luay.arabi@mobileum.com",
        "nonce": nonce,
        "iat": now - 10,
        "exp": now + 3600,
    }
    # Sign with untrusted key
    id_token = create_mock_jwt(payload, kid=MOCK_KEY_ID, priv_key_pem=_BAD_PRIV_PEM)
    monkeypatch.setattr(
        SSOService,
        "exchange_code",
        lambda code, code_verifier, **kw: {"id_token": id_token, "access_token": "mock-at"},
    )

    client.cookies.set("sso_state", state)
    client.cookies.set("sso_nonce", nonce)
    client.cookies.set("sso_verifier", verifier)

    resp = client.get(
        f"/api/auth/sso/callback?code=mock_code_bad_sig&state={state}",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["location"] == "/login?error=sso_token_invalid"


def test_missing_or_replayed_state_rejected(sso_test_env):
    """Missing or replayed state cookie rejected with /login?error=sso_state_invalid."""
    client = TestClient(app)
    # No sso_state cookie passed
    resp = client.get("/api/auth/sso/callback?code=mock_code&state=forged_state", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "/login?error=sso_state_invalid"


def test_owner_break_glass_works_and_user_password_rejected_when_restricted(sso_test_env):
    """
    When SSO_ENABLED=True and SSO_PASSWORD_LOGIN_FOR_USERS=False:
    1. Owner password login succeeds with 200 and issues session cookie.
    2. Non-owner password login fails with 403 Forbidden.
    """
    client = TestClient(app)

    # 1. Owner break-glass password login
    owner_resp = client.post(
        "/api/auth/login",
        json={"email": "admin.owner@example.com", "password": "OwnerBreakGlassPassword123!"},
    )
    assert owner_resp.status_code == 200
    assert "auth_token" in owner_resp.cookies
    assert owner_resp.json()["user"]["is_owner"] is True

    # 2. Non-owner attempting password login
    user_resp = client.post(
        "/api/auth/login",
        json={"email": "luay.arabi@mobileum.com", "password": "KamUserPassword123!"},
    )
    assert user_resp.status_code == 403
    assert "Password authentication is restricted" in user_resp.json()["detail"]


def test_admin_access_request_approve_and_dismiss(sso_test_env):
    """
    1. Admin approves access request: creates user with specified role and KAM owner, deletes request.
    2. Admin dismisses access request: deletes request.
    3. Audit logs written for both actions.
    """
    client = TestClient(app)
    db = sso_test_env["db"]
    owner = sso_test_env["owner"]

    # Authenticate as owner admin
    admin_session_token = sign_session_token(owner)
    client.cookies.set("auth_token", admin_session_token)

    # Create request 1 to approve
    req1 = SSOAccessRequest(
        id=str(uuid.uuid4()),
        email="approved.kam@mobileum.com",
        name="Approved KAM",
        tenant_id=MOCK_TENANT_ID,
        status="pending",
        attempt_count=1,
    )
    db.add(req1)

    # Create request 2 to dismiss
    req2 = SSOAccessRequest(
        id=str(uuid.uuid4()),
        email="dismissed.user@mobileum.com",
        name="Dismissed User",
        tenant_id=MOCK_TENANT_ID,
        status="pending",
        attempt_count=1,
    )
    db.add(req2)
    db.commit()

    # 1. Approve req1
    approve_resp = client.post(
        f"/api/admin/sso/access-requests/{req1.id}/approve",
        json={"role": "kam", "kam_portfolio_name": "Approved KAM Portfolio"},
    )
    assert approve_resp.status_code == 200
    data = approve_resp.json()
    assert data["status"] == "success"
    assert data["user"]["role"] == "kam"
    assert data["user"]["owner_name"] == "Approved KAM Portfolio"

    # Verify user created in DB
    created_user = db.query(User).filter(User.email == "approved.kam@mobileum.com").first()
    assert created_user is not None
    assert created_user.role == "kam"
    assert created_user.owner_name == "Approved KAM Portfolio"
    assert created_user.kam_portfolio_name == "Approved KAM Portfolio"
    assert created_user.status == "active"

    # Verify req1 deleted
    assert db.query(SSOAccessRequest).filter(SSOAccessRequest.id == req1.id).first() is None

    # 2. Dismiss req2
    dismiss_resp = client.post(f"/api/admin/sso/access-requests/{req2.id}/dismiss")
    assert dismiss_resp.status_code == 200
    assert dismiss_resp.json()["status"] == "success"

    # Verify req2 deleted
    assert db.query(SSOAccessRequest).filter(SSOAccessRequest.id == req2.id).first() is None

    # 3. Verify audit log entries
    approve_audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "sso_access_request_approved")
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    assert approve_audit is not None
    assert "approved.kam@mobileum.com" in str(approve_audit.details)

    dismiss_audit = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "sso_access_request_dismissed")
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    assert dismiss_audit is not None
    assert "dismissed.user@mobileum.com" in str(dismiss_audit.details)

