"""Ledger-specific database configuration."""
from pathlib import Path
from typing import Generator, Optional
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from app.core.config import settings
from app.crypto.signer import get_project_root


def get_resolved_ledger_sqlite_url(raw_url: Optional[str] = None) -> str:
    """Resolve SQLite URL to an absolute path anchored to project root if relative."""
    url = raw_url or settings.LEDGER_SQLITE_URL
    if url.startswith("sqlite:///") and not url.startswith("sqlite:///:memory:"):
        path_str = url[len("sqlite:///"):]
        p = Path(path_str)
        if not p.is_absolute():
            project_root = get_project_root()
            clean_rel = path_str.lstrip("./") if path_str.startswith("./") else path_str
            resolved_path = (project_root / clean_rel).resolve()
            resolved_path.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{resolved_path}"
    return url


ledger_engine = create_engine(
    get_resolved_ledger_sqlite_url(),
    connect_args={"check_same_thread": False},
)


@event.listens_for(ledger_engine, "connect")
def set_ledger_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.close()


LedgerSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=ledger_engine)

LedgerBase = declarative_base()


def ensure_ledger_schema(engine=None):
    """Ensure ledger_events table and signing_key_fingerprint column exist."""
    target_engine = engine or ledger_engine
    try:
        with target_engine.connect() as conn:
            cursor = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_events'"))
            if cursor.fetchone():
                col_cursor = conn.execute(text("PRAGMA table_info(ledger_events)"))
                columns = [row[1] for row in col_cursor.fetchall()]
                if "signing_key_fingerprint" not in columns:
                    conn.execute(text("ALTER TABLE ledger_events ADD COLUMN signing_key_fingerprint VARCHAR(64)"))
                    conn.commit()
    except Exception:
        pass


ensure_ledger_schema()


def get_ledger_db() -> Generator[Session, None, None]:
    """Get a ledger database session."""
    ensure_ledger_schema()
    db = LedgerSessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        