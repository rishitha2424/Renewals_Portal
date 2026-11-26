"""
Microsoft SSO (Entra ID / Azure AD OIDC) Authentication Service.
Handles PKCE authorization URL generation, authorization code exchange,
JWKS signature verification, claim validation (tenant, audience, nonce, expiry),
and corporate domain enforcement.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import time
import urllib.parse
from typing import Any, Dict, Optional, Tuple, List

import httpx
from authlib.jose import JsonWebKey, jwt

from backend.config import settings

log = logging.getLogger(__name__)

# In-memory cache for tenant JWKS keys: {tenant_id: (cached_at_timestamp, jwks_dict)}
_JWKS_CACHE: Dict[str, Tuple[float, dict]] = {}
JWKS_CACHE_TTL_SECONDS = 3600  # 1 hour


def _b64decode_padding(s: str) -> bytes:
    padded = s + "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


class SSOService:
    """Service encapsulating Microsoft Entra ID OIDC workflow."""

    @classmethod
    def get_authority_url(cls, tenant_id: Optional[str] = None) -> str:
        tid = tenant_id or settings.AZURE_TENANT_ID
        return f"https://login.microsoftonline.com/{tid}"

    @classmethod
    def get_discovery_url(cls, tenant_id: Optional[str] = None) -> str:
        return f"{cls.get_authority_url(tenant_id)}/v2.0/.well-known/openid-configuration"

    @classmethod
    def get_jwks_url(cls, tenant_id: Optional[str] = None) -> str:
        return f"{cls.get_authority_url(tenant_id)}/discovery/v2.0/keys"

    @classmethod
    def get_authorize_url(cls, tenant_id: Optional[str] = None) -> str:
        return f"{cls.get_authority_url(tenant_id)}/oauth2/v2.0/authorize"

    @classmethod
    def get_token_url(cls, tenant_id: Optional[str] = None) -> str:
        return f"{cls.get_authority_url(tenant_id)}/oauth2/v2.0/token"

    @classmethod
    def generate_auth_url(
        cls,
        redirect_uri: Optional[str] = None,
        tenant_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> Tuple[str, str, str, str]:
        """
        Generate Microsoft Entra ID authorization URL with PKCE (S256), state, and nonce.
        Returns: (auth_url, state, nonce, code_verifier)
        """
        tid = tenant_id or settings.AZURE_TENANT_ID
        cid = client_id or settings.AZURE_CLIENT_ID
        effective_redirect = redirect_uri or settings.effective_sso_redirect_uri

        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        code_verifier = secrets.token_urlsafe(64)

        # S256 PKCE Code Challenge
        challenge_bytes = hashlib.sha256(code_verifier.encode("ascii")).digest()
        code_challenge = base64.urlsafe_b64encode(challenge_bytes).decode("ascii").rstrip("=")

        params = {
            "client_id": cid,
            "response_type": "code",
            "redirect_uri": effective_redirect,
            "response_mode": "query",
            "scope": "openid profile email",
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        auth_url = f"{cls.get_authorize_url(tid)}?{urllib.parse.urlencode(params)}"
        return auth_url, state, nonce, code_verifier

    @classmethod
    def exchange_code(
        cls,
        code: str,
        code_verifier: str,
        redirect_uri: Optional[str] = None,
        tenant_id: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
    ) -> dict:
        """
        Exchange authorization code and PKCE code_verifier for id_token and access_token.
        """
        tid = tenant_id or settings.AZURE_TENANT_ID
        cid = client_id or settings.AZURE_CLIENT_ID
        csec = client_secret or settings.AZURE_CLIENT_SECRET
        effective_redirect = redirect_uri or settings.effective_sso_redirect_uri

        token_url = cls.get_token_url(tid)
        data = {
            "client_id": cid,
            "client_secret": csec,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": effective_redirect,
            "code_verifier": code_verifier,
            "scope": "openid profile email",
        }

        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(token_url, data=data)
        except Exception as exc:
            log.warning("SSO token exchange network failure: %s", exc)
            raise ValueError(f"Failed to communicate with Microsoft identity provider: {exc}")

        if resp.status_code != 200:
            err_detail = "Failed to exchange authorization code"
            try:
                err_data = resp.json()
                err_detail = err_data.get("error_description") or err_data.get("error") or err_detail
            except Exception:
                pass
            log.warning("SSO token exchange returned status %d: %s", resp.status_code, err_detail)
            raise ValueError(f"Microsoft token exchange error: {err_detail}")

        return resp.json()

    @classmethod
    def fetch_jwks(cls, tenant_id: Optional[str] = None) -> dict:
        """Fetch and cache Microsoft tenant JWKS public keys."""
        tid = tenant_id or settings.AZURE_TENANT_ID
        now = time.time()
        cached = _JWKS_CACHE.get(tid)
        if cached and (now - cached[0]) < JWKS_CACHE_TTL_SECONDS:
            return cached[1]

        jwks_url = cls.get_jwks_url(tid)
        try:
            with httpx.Client(timeout=20.0) as client:
                resp = client.get(jwks_url)
                resp.raise_for_status()
                jwks_data = resp.json()
                _JWKS_CACHE[tid] = (now, jwks_data)
                return jwks_data
        except Exception as exc:
            log.warning("Failed to fetch JWKS from %s: %s", jwks_url, exc)
            raise ValueError(f"Could not retrieve Microsoft signing keys from {jwks_url}: {exc}")

    @classmethod
    def validate_id_token(
        cls,
        id_token: str,
        expected_nonce: Optional[str] = None,
        tenant_id: Optional[str] = None,
        client_id: Optional[str] = None,
        custom_jwks: Optional[dict] = None,
    ) -> dict:
        """
        Validate Microsoft Entra ID id_token:
        1. Form and header validation (kid, alg=RS256)
        2. Cryptographic signature check against Microsoft JWKS
        3. Claims verification: tenant (tid), audience (aud), issuer (iss), nonce, expiration (exp)
        Returns the validated claims dictionary.
        """
        tid = tenant_id or settings.AZURE_TENANT_ID
        cid = client_id or settings.AZURE_CLIENT_ID

        if not id_token or not isinstance(id_token, str):
            raise ValueError("Missing or invalid id_token string")

        parts = id_token.split(".")
        if len(parts) != 3:
            raise ValueError("Malformed JWT id_token (must have 3 dot-separated parts)")

        # 1. Unverified header inspection to get kid
        try:
            header_json = _b64decode_padding(parts[0]).decode("utf-8")
            header = json.loads(header_json)
        except Exception as exc:
            raise ValueError(f"Malformed JWT header: {exc}")

        kid = header.get("kid")
        alg = header.get("alg")
        if not kid:
            raise ValueError("JWT header is missing 'kid' claim")
        if alg not in ("RS256", "RSA-OAEP", "RSA-OAEP-256"):
            raise ValueError(f"Unsupported JWT signing algorithm: {alg} (expected RS256)")

        # 2. Key matching from JWKS
        jwks = custom_jwks or cls.fetch_jwks(tid)
        keys = jwks.get("keys", [])
        matched_key_dict = next((k for k in keys if k.get("kid") == kid), None)
        if not matched_key_dict:
            # Refresh cache once if key is unknown
            if not custom_jwks:
                _JWKS_CACHE.pop(tid, None)
                jwks = cls.fetch_jwks(tid)
                matched_key_dict = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)

        if not matched_key_dict:
            raise ValueError(f"Signing key '{kid}' not found in Microsoft tenant JWKS")

        # 3. Cryptographic signature verification
        try:
            key = JsonWebKey.import_key(matched_key_dict)
            claims = jwt.decode(id_token, key)
            claims.validate()  # Validates iat, exp, nbf
        except Exception as exc:
            log.warning("JWT signature verification failed: %s", exc)
            raise ValueError(f"JWT signature verification failed: {exc}")

        # 4. Enforce tenant ID claim (tid)
        token_tid = claims.get("tid")
        if tid and token_tid and token_tid.lower() != tid.lower():
            raise ValueError(f"Tenant ID mismatch: token tid '{token_tid}' != configured tenant '{tid}'")

        # 5. Enforce audience (aud) matches Application (client) ID
        token_aud = claims.get("aud")
        if cid and token_aud != cid:
            raise ValueError(f"Audience mismatch: token aud '{token_aud}' != configured client_id '{cid}'")

        # 6. Enforce issuer (iss) matches Microsoft tenant v2.0 endpoint
        token_iss = claims.get("iss", "")
        expected_iss_v2 = f"https://login.microsoftonline.com/{tid}/v2.0"
        expected_iss_v1 = f"https://sts.windows.net/{tid}/"
        if tid and not (token_iss == expected_iss_v2 or token_iss == expected_iss_v1):
            raise ValueError(f"Issuer mismatch: token iss '{token_iss}' does not match tenant '{tid}'")

        # 7. Enforce nonce match if nonce was generated in login step
        if expected_nonce:
            token_nonce = claims.get("nonce")
            if not token_nonce or token_nonce != expected_nonce:
                raise ValueError("Nonce mismatch or missing in id_token")

        return dict(claims)

    @classmethod
    def extract_email(cls, claims: dict) -> str:
        """
        Extract user corporate email from verified claims in priority order
        defined by settings.SSO_EMAIL_CLAIM (default: email, preferred_username, upn).
        """
        priority_str = getattr(settings, "SSO_EMAIL_CLAIM", "email,preferred_username,upn")
        claim_names = [c.strip() for c in priority_str.split(",") if c.strip()]

        for claim_name in claim_names:
            val = claims.get(claim_name)
            if val and isinstance(val, str) and "@" in val:
                return val.strip().lower()

        # Fallback inspection of common OIDC fields
        for fallback in ("email", "preferred_username", "upn", "unique_name"):
            val = claims.get(fallback)
            if val and isinstance(val, str) and "@" in val:
                return val.strip().lower()

        raise ValueError("Could not extract email address from Microsoft identity claims")

    @classmethod
    def extract_name(cls, claims: dict, fallback_email: str) -> str:
        """Extract user display name from verified claims."""
        name = claims.get("name")
        if name and isinstance(name, str) and name.strip():
            return name.strip()
        given = claims.get("given_name", "")
        family = claims.get("family_name", "")
        full = f"{given} {family}".strip()
        if full:
            return full
        return fallback_email.split("@")[0].replace(".", " ").title()

    @classmethod
    def is_domain_allowed(cls, email: str) -> bool:
        """Check email against SSO_ALLOWED_DOMAINS if configured."""
        allowed_str = getattr(settings, "SSO_ALLOWED_DOMAINS", "").strip()
        if not allowed_str:
            return True
        allowed_domains = {d.strip().lower() for d in allowed_str.split(",") if d.strip()}
        if "@" not in email:
            return False
        domain = email.split("@", 1)[1].strip().lower()
        return domain in allowed_domains

    @classmethod
    def test_connection(cls, tenant_id: Optional[str] = None) -> dict:
        """
        Admin test: verify Microsoft Entra ID OpenID configuration and JWKS keys
        endpoints are reachable from this server.
        """
        tid = tenant_id or settings.AZURE_TENANT_ID
        if not tid:
            return {
                "reachable": False,
                "latency_ms": 0,
                "tenant_id": "(not configured)",
                "detail": "AZURE_TENANT_ID is not configured in .env",
            }

        disc_url = cls.get_discovery_url(tid)
        jwks_url = cls.get_jwks_url(tid)
        t0 = time.perf_counter()

        try:
            with httpx.Client(timeout=15.0) as client:
                r1 = client.get(disc_url)
                r1.raise_for_status()
                r2 = client.get(jwks_url)
                r2.raise_for_status()
                keys_data = r2.json()
                latency_ms = round((time.perf_counter() - t0) * 1000, 1)

                key_count = len(keys_data.get("keys", []))
                return {
                    "reachable": True,
                    "latency_ms": latency_ms,
                    "tenant_id": tid,
                    "key_count": key_count,
                    "detail": f"Successfully connected to Microsoft Entra ID. {key_count} active signing keys retrieved ({latency_ms}ms).",
                }
        except httpx.ConnectError:
            return {
                "reachable": False,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                "tenant_id": tid,
                "detail": "Network connection error: Unable to reach login.microsoftonline.com. Check VM DNS and firewall egress on port 443.",
            }
        except httpx.TimeoutException:
            return {
                "reachable": False,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                "tenant_id": tid,
                "detail": "Connection timed out connecting to login.microsoftonline.com after 15 seconds.",
            }
        except Exception as exc:
            return {
                "reachable": False,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                "tenant_id": tid,
                "detail": f"Microsoft SSO connection test failed: {exc}",
            }

