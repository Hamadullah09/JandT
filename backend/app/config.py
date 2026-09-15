"""Application settings and the single source of truth for the fixed sender.

Every value here is overridable through environment variables prefixed ``JT_``
(see ``.env.example``).  Nothing in this module touches the database; the seeded
``sender_profile`` row is created from :data:`DEFAULT_SENDER` on first boot and
is authoritative from then on.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="JT_",
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+asyncpg://jt:jt@localhost:5432/jt"

    # Bulk output directories must resolve underneath this root.  Empty string
    # disables the restriction (host installs); inside Docker it is the mount.
    output_root: str = ""

    # ---- tracking numbers ------------------------------------------------
    tracking_prefix: str = "63"
    tracking_mode: Literal["SEQUENCE", "RANDOM"] = "SEQUENCE"
    tracking_seq_start: int = 2_158_571_544

    # ---- rendering -------------------------------------------------------
    render_workers: int = 0          # 0 -> os.cpu_count()
    render_chunk: int = 32           # orders per pool task
    pipeline_chunk: int = 1000       # rows per persist/render chunk
    merge_pdf: bool = False

    # ---- api -------------------------------------------------------------
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )
    max_upload_mb: int = 64
    rates_file: str = str(BACKEND_DIR / "config" / "rates.yml")

    @field_validator("tracking_prefix")
    @classmethod
    def _prefix_digits(cls, v: str) -> str:
        if not v.isdigit() or not 1 <= len(v) <= 4:
            raise ValueError("tracking_prefix must be 1-4 digits")
        return v

    @property
    def sync_database_url(self) -> str:
        """psycopg/SQLAlchemy-sync URL - used by Alembic."""
        return self.database_url.replace("+asyncpg", "")

    @property
    def workers(self) -> int:
        return self.render_workers or (os.cpu_count() or 4)

    @property
    def output_root_path(self) -> Path | None:
        return Path(self.output_root).resolve() if self.output_root else None

    @property
    def default_output_dir(self) -> Path:
        """Where waybills land when the caller does not name a directory.

        Inside Docker this is the mounted volume; on a host install it is
        ``<repo>/waybills``.
        """
        return self.output_root_path or (REPO_DIR / "waybills")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


# ---------------------------------------------------------------------------
# Fixed sender profile (spec section 5).  Seeded once; edited via the API.
# ---------------------------------------------------------------------------
DEFAULT_SENDER: dict[str, Any] = {
    "account_code": "JTMY027288",
    "company_name": "LINKED INTERNATIONAL SDN BHD",
    "phone": "+60 135763706",
    "postcode": "43300",
    "state": "SELANGOR/PETALING/SERI KEMBANGAN",
    "address": "B-09-09, PERDANA SELATAN, TAMAN SERDANG PERDANA, 43300",
    "payment_type": "MONTHLY",
    "default_service": "NORMAL",
}


@lru_cache(maxsize=1)
def get_rates() -> dict[str, Any]:
    """Load and cache the freight rate card."""
    path = Path(get_settings().rates_file)
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)
