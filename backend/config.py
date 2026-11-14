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


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    DATABASE_URL: str = f"sqlite:///{(ROOT_DIR / 'renewals.db').as_posix()}"

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

    # Security & Admin Auth (Addendum D)
    TESTING: bool = False
    ENVIRONMENT: str = "development"
    ADMIN_PASSWORD: str = ""
    ADMIN_SECRET_KEY: str = ""
    COOKIE_SECURE: Optional[bool] = None
    ADMIN_TOKEN_EXPIRE_HOURS: int = 8

    @property
    def is_cookie_secure(self) -> bool:
        if self.COOKIE_SECURE is not None:
            return self.COOKIE_SECURE
        return self.ENVIRONMENT.lower() == "production"

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
