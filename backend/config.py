"""
Application configuration — all settings come from environment variables or .env.
Never hard-code secrets or model names here.
"""
import os
from typing import Optional, Any
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


def get_env_file_path() -> Path:
    """Return the absolute path to the .env file."""
    candidates = [
        ROOT_DIR / ".env",
        Path.cwd() / ".env",
    ]
    for p in candidates:
        if p.exists() and p.is_file():
            return p.resolve()
    return (ROOT_DIR / ".env").resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(get_env_file_path()),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    DATABASE_URL: str = f"sqlite:///{(ROOT_DIR / 'renewals.db').as_posix()}"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 15
    DB_POOL_RECYCLE: int = 1800
    SQLITE_BUSY_TIMEOUT_MS: int = 10000
    # Optional SQLite journal mode (e.g. "WAL" or "DELETE"). None leaves existing DB mode untouched.
    SQLITE_JOURNAL_MODE: Optional[str] = None
    SLOW_REQUEST_LOG_SECONDS: float = 2.0
    # Snapshot-scoped analytics & export cache settings
    ANALYTICS_CACHE_TTL_SECONDS: int = 300
    ANALYTICS_CACHE_MAX_ENTRIES: int = 256
    EXPORT_CACHE_MAX_ENTRIES: int = 24

    @property
    def sqlalchemy_database_url(self) -> str:
        """Ensure standard postgres:// or postgresql:// URLs use an available psycopg dialect."""
        url = self.DATABASE_URL
        if not url:
            db_path = (ROOT_DIR / 'renewals.db').resolve().as_posix()
            return f"sqlite:///{db_path}"

        if url.startswith(("postgres://", "postgresql://", "postgresql+")):
            has_psycopg3 = False
            has_psycopg2 = False
            try:
                import psycopg  # noqa: F401
                has_psycopg3 = True
            except ImportError:
                pass
            try:
                import psycopg2  # noqa: F401
                has_psycopg2 = True
            except ImportError:
                pass

            target_driver = "postgresql+psycopg://" if has_psycopg3 else ("postgresql+psycopg2://" if has_psycopg2 else "postgresql://")
            for prefix in ("postgresql+psycopg2://", "postgresql+psycopg://", "postgresql://", "postgres://"):
                if url.startswith(prefix):
                    return target_driver + url[len(prefix):]
        return url

    # AI provider (stub by default; swap to "gemini" or "openai" via .env)
    AI_PROVIDER: str = "demo"          # "demo" | "gemini" | "openai" | "custom"
    AI_BASE_URL: str = ""              # e.g. https://generativelanguage.googleapis.com
    AI_MODEL_NAME: str = ""            # e.g. gemini-1.5-flash  (never hard-coded)
    AI_API_KEY: str = ""

    # AI / LLM provider
    DEMO_MODE: bool = True
    LLM_BASE_URL: str = ""             # e.g. https://api.openai.com/v1
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "gpt-4o-mini"
    LLM_TIMEOUT: int = 30
    LLM_MAX_TOOL_CALLS: int = 6
    LLM_SEND_MODE: str = "aggregates"  # "aggregates" | "full"

    # Paths
    DATA_DIR: Path = ROOT_DIR / "data"
    ASSETS_DIR: Path = ROOT_DIR / "assets"
    REPORT_LOGO_PATH: Path = ROOT_DIR / "assets" / "logo.png"

    # App
    APP_TITLE: str = "Mobileum Horizon"
    APP_VERSION: str = "1.0.0"
    CORS_ORIGINS: Any = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("CORS_ORIGINS")
    @classmethod
    def parse_cors_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return ["*"]
            if v.startswith("[") and v.endswith("]"):
                try:
                    import json
                    parsed = json.loads(v)
                    if isinstance(parsed, list):
                        return [str(x).strip() for x in parsed if str(x).strip()]
                except Exception:
                    pass
            # Split comma or whitespace separated string
            parts = [part.strip() for part in v.replace(",", " ").split() if part.strip()]
            return parts or ["*"]
        if isinstance(v, (list, tuple, set)):
            return [str(x).strip() for x in v if str(x).strip()]
        return ["*"]
    FISCAL_YEAR_START_MONTH: int = 1
    DELAYED_INCLUDE_PRIOR_FY: bool = True
    APPROVAL_DEAL_SIZE_THRESHOLD: float = 100000.0
    NEEDS_ATTENTION_WINDOW_DAYS: int = 14
    NEEDS_ATTENTION_MAX_ITEMS: int = 5

    # Security & Admin Auth (Addendum D & Round 18)
    TESTING: bool = False
    ENVIRONMENT: str = "development"
    ADMIN_PASSWORD: str = ""
    ADMIN_SECRET_KEY: str = ""
    OWNER_EMAIL: Optional[str] = None
    OWNER_NAME: Optional[str] = None
    COOKIE_SECURE: Optional[bool] = None
    ADMIN_TOKEN_EXPIRE_HOURS: int = 8
    AUTH_SESSION_EXPIRE_HOURS: int = 24
    INVITE_TOKEN_EXPIRE_HOURS: int = 72
    RESET_TOKEN_EXPIRE_HOURS: int = 24
    MAX_FAILED_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_DURATION_MINUTES: int = 15
    BCRYPT_ROUNDS: int = 12

    # Email & SMTP Configuration (Round 18)
    MAIL_ENABLED: bool = False
    SMTP_HOST: str = "smtp.office365.com"
    SMTP_PORT: int = 587
    SMTP_TIMEOUT: int = 60
    SMTP_TIMEOUT_SECONDS: int = 60
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_STARTTLS: bool = True
    SMTP_SSL: bool = False
    MAIL_FROM: str = "renewals@mobileum.com"
    APP_BASE_URL: str = "http://localhost:5173"
    ADMIN_ALERT_EMAIL: str = "alerts@mobileum.com"

    # Microsoft SSO / Entra ID (OIDC)
    SSO_ENABLED: bool = False
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""
    SSO_REDIRECT_URI: str = ""
    SSO_ALLOWED_DOMAINS: str = ""
    SSO_EMAIL_CLAIM: str = "email,preferred_username,upn"
    SSO_LOCAL_LOGIN_ENABLED: bool = True
    SSO_PASSWORD_LOGIN_FOR_USERS: bool = False
    SSO_CLIENT_SECRET_EXPIRES: str = ""

    @field_validator("MAIL_ENABLED", "SMTP_STARTTLS", "SMTP_SSL", "COOKIE_SECURE", "SSO_ENABLED", "SSO_LOCAL_LOGIN_ENABLED", "SSO_PASSWORD_LOGIN_FOR_USERS", mode="before")
    @classmethod
    def parse_bool_env(cls, v: Any) -> Any:
        """Parse boolean values case-insensitively, handling string representations and whitespace."""
        if v is None:
            return None
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return bool(v)
        if isinstance(v, str):
            cleaned = v.strip().strip("'\"").lower()
            if cleaned in ("none", "null", ""):
                return None
            return cleaned in ("true", "1", "yes", "t", "on")
        return bool(v)

    @field_validator("SMTP_PORT", "SMTP_TIMEOUT", "SMTP_TIMEOUT_SECONDS", "BCRYPT_ROUNDS", mode="before")
    @classmethod
    def parse_int_env(cls, v: Any) -> int:
        """Parse port/timeout/cost integer safely from string representations."""
        if isinstance(v, int):
            return v
        if isinstance(v, str):
            cleaned = v.strip().strip("'\"")
            try:
                return int(cleaned)
            except ValueError:
                return 587
        return int(v)

    def reload_from_env(self) -> None:
        """Reload settings from .env and environment into this instance in-place."""
        new_inst = Settings()
        for k, v in new_inst.__dict__.items():
            if not k.startswith("_"):
                setattr(self, k, v)

    def get_mail_diagnostics(self) -> dict:
        """Return safe mail diagnostics with secrets masked."""
        env_path = get_env_file_path()
        file_exists = env_path.exists()

        def _is_set(val: Any) -> bool:
            if val is None:
                return False
            if isinstance(val, str):
                return bool(val.strip())
            return True

        variables = {
            "MAIL_ENABLED": {
                "set": _is_set(self.MAIL_ENABLED),
                "value": bool(self.MAIL_ENABLED),
            },
            "SMTP_HOST": {
                "set": _is_set(self.SMTP_HOST),
                "value": self.SMTP_HOST or "(not set)",
            },
            "SMTP_PORT": {
                "set": _is_set(self.SMTP_PORT),
                "value": self.SMTP_PORT,
            },
            "SMTP_USER": {
                "set": _is_set(self.SMTP_USER),
                "value": self.SMTP_USER or "(not set)",
            },
            "SMTP_PASSWORD": {
                "set": _is_set(self.SMTP_PASSWORD),
                "value": "***" if _is_set(self.SMTP_PASSWORD) else "(not set)",
            },
            "SMTP_STARTTLS": {
                "set": _is_set(self.SMTP_STARTTLS),
                "value": bool(self.SMTP_STARTTLS),
            },
            "SMTP_SSL": {
                "set": _is_set(self.SMTP_SSL),
                "value": bool(self.SMTP_SSL),
            },
            "MAIL_FROM": {
                "set": _is_set(self.MAIL_FROM),
                "value": self.MAIL_FROM or "(not set)",
            },
            "SMTP_TIMEOUT": {
                "set": _is_set(self.SMTP_TIMEOUT),
                "value": self.SMTP_TIMEOUT,
            },
            "SMTP_TIMEOUT_SECONDS": {
                "set": _is_set(self.SMTP_TIMEOUT_SECONDS),
                "value": self.SMTP_TIMEOUT_SECONDS,
            },
        }

        # Determine exact reason why mail is active or inactive
        if not file_exists:
            inactive_reason = f".env file not found at {env_path}"
        elif not self.MAIL_ENABLED:
            inactive_reason = "MAIL_ENABLED is false"
        elif not (self.SMTP_HOST and self.SMTP_HOST.strip()):
            inactive_reason = "SMTP_HOST missing"
        elif not self.SMTP_PORT:
            inactive_reason = "SMTP_PORT missing or invalid"
        elif not (self.MAIL_FROM and self.MAIL_FROM.strip()):
            inactive_reason = "MAIL_FROM missing"
        elif self.SMTP_USER and not (self.SMTP_PASSWORD and self.SMTP_PASSWORD.strip()):
            inactive_reason = "SMTP_PASSWORD missing"
        else:
            inactive_reason = "Mail is active and configured"

        is_configured = (inactive_reason == "Mail is active and configured")

        return {
            "env_file_path": str(env_path),
            "env_file_exists": file_exists,
            "mail_enabled": bool(self.MAIL_ENABLED),
            "mail_active": is_configured and bool(self.MAIL_ENABLED),
            "is_configured": is_configured,
            "inactive_reason": inactive_reason,
            "timeout": self.SMTP_TIMEOUT,
            "timeout_seconds": self.SMTP_TIMEOUT,
            "variables": variables,
        }

    @property
    def is_cookie_secure(self) -> bool:
        if self.COOKIE_SECURE is not None:
            return self.COOKIE_SECURE
        return self.ENVIRONMENT.lower() == "production"

    @property
    def effective_sso_redirect_uri(self) -> str:
        if self.SSO_REDIRECT_URI and self.SSO_REDIRECT_URI.strip():
            return self.SSO_REDIRECT_URI.strip()
        base = (self.APP_BASE_URL or "http://localhost:5173").rstrip("/")
        return f"{base}/api/auth/sso/callback"

    def get_sso_public_config(self) -> dict:
        """Safe public SSO configuration. Never leaks secrets or tenant details."""
        domains = [d.strip().lower() for d in self.SSO_ALLOWED_DOMAINS.split(",") if d.strip()] if self.SSO_ALLOWED_DOMAINS else []
        return {
            "sso_enabled": bool(self.SSO_ENABLED),
            "sso_local_login_enabled": bool(self.SSO_LOCAL_LOGIN_ENABLED),
            "sso_password_login_for_users": bool(self.SSO_PASSWORD_LOGIN_FOR_USERS),
            "allowed_domains": domains,
            "redirect_uri": self.effective_sso_redirect_uri,
        }

    def get_sso_admin_diagnostics(self) -> dict:
        """Safe admin diagnostics with secrets masked."""
        def mask_val(v: str) -> str:
            v = (v or "").strip()
            if not v:
                return "(not configured)"
            if len(v) <= 8:
                return "••••••••"
            return f"{v[:4]}••••••••{v[-4:]}"

        return {
            "sso_enabled": bool(self.SSO_ENABLED),
            "tenant_id_masked": mask_val(self.AZURE_TENANT_ID),
            "client_id_masked": mask_val(self.AZURE_CLIENT_ID),
            "redirect_uri": self.effective_sso_redirect_uri,
            "allowed_domains": self.SSO_ALLOWED_DOMAINS or "(all domains allowed)",
            "email_claim_priority": self.SSO_EMAIL_CLAIM,
            "local_login_enabled": bool(self.SSO_LOCAL_LOGIN_ENABLED),
            "password_login_for_users": bool(self.SSO_PASSWORD_LOGIN_FOR_USERS),
            "secret_configured": bool(self.AZURE_CLIENT_SECRET and self.AZURE_CLIENT_SECRET.strip()),
            "secret_expires": self.SSO_CLIENT_SECRET_EXPIRES or "(no expiry date set)",
        }

    @property
    def is_admin_configured(self) -> bool:
        disallowed_keys = {
            "",
            "supersecret_renewals_admin_signing_key_change_in_prod",
            "change_this_to_a_long_random_secret_in_production",
        }
        return bool(self.ADMIN_PASSWORD and self.ADMIN_PASSWORD.strip()) and bool(
            self.ADMIN_SECRET_KEY and self.ADMIN_SECRET_KEY.strip() and self.ADMIN_SECRET_KEY.strip() not in disallowed_keys
        )


settings = Settings()
