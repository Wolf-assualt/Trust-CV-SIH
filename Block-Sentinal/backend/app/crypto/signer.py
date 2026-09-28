"""Ed25519 Key Management, Digital Signatures, and Verification."""
import logging
import os
from pathlib import Path
from typing import Optional, Union, Tuple
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ed25519, ec

logger = logging.getLogger("trust_cv.crypto.signer")


class KeyManager:
    """Manages Ed25519 asymmetric keypairs for signing digests and evidence records."""

    def __init__(self, private_key_pem: Optional[bytes] = None):
        if private_key_pem:
            loaded_key = serialization.load_pem_private_key(private_key_pem, password=None)
            if not isinstance(loaded_key, ed25519.Ed25519PrivateKey):
                raise ValueError("Provided key is not an Ed25519 private key")
            self.private_key = loaded_key
        else:
            self.private_key = ed25519.Ed25519PrivateKey.generate()
        self.public_key = self.private_key.public_key()

    def export_private_key_pem(self) -> bytes:
        """Export private key in PKCS8 PEM format."""
        return self.private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

    def export_public_key_pem(self) -> bytes:
        """Export public key in SubjectPublicKeyInfo PEM format."""
        return self.public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )

    def get_public_key_fingerprint(self) -> str:
        """Return truncated SHA-256 fingerprint of the DER-encoded public key."""
        der_bytes = self.public_key.public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        import hashlib
        return hashlib.sha256(der_bytes).hexdigest()[:16]

    @property
    def fingerprint(self) -> str:
        """Convenience property for key fingerprint."""
        return self.get_public_key_fingerprint()

    @staticmethod
    def compute_public_key_fingerprint(public_key_pem: Union[bytes, str]) -> Optional[str]:
        """Compute fingerprint from public key PEM string or bytes."""
        try:
            if isinstance(public_key_pem, str):
                public_key_pem = public_key_pem.encode("utf-8")
            pubkey = serialization.load_pem_public_key(public_key_pem)
            der_bytes = pubkey.public_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            import hashlib
            return hashlib.sha256(der_bytes).hexdigest()[:16]
        except Exception:
            return None

    def sign_hash(self, digest_hex: Union[str, bytes]) -> str:
        """Sign a digest using Ed25519 and return the hex-encoded signature."""
        if isinstance(digest_hex, str):
            data = digest_hex.encode("utf-8")
        else:
            data = digest_hex
        signature_bytes = self.private_key.sign(data)
        return signature_bytes.hex()

    @staticmethod
    def verify_signature(
        public_key_pem: Union[bytes, str],
        digest_hex: Union[str, bytes],
        signature_hex: str,
        algorithm: str = "ed25519",
    ) -> bool:
        """Verify an Ed25519 or legacy ECDSA SECP256R1 signature against the provided public key PEM."""
        try:
            if isinstance(public_key_pem, str):
                public_key_pem = public_key_pem.encode("utf-8")
            pubkey = serialization.load_pem_public_key(public_key_pem)
            sig_bytes = bytes.fromhex(signature_hex)
            if isinstance(digest_hex, str):
                data = digest_hex.encode("utf-8")
            else:
                data = digest_hex

            algo = (algorithm or "ed25519").lower().strip()
            if algo in ("ed25519", "ed_25519"):
                if isinstance(pubkey, ed25519.Ed25519PublicKey):
                    pubkey.verify(sig_bytes, data)
                    return True
                return False
            elif algo in ("ecdsa-p256", "ecdsa_p256", "ecdsa"):
                if isinstance(pubkey, ec.EllipticCurvePublicKey):
                    pubkey.verify(sig_bytes, data, ec.ECDSA(hashes.SHA256()))
                    return True
                return False
            return False
        except (InvalidSignature, ValueError, TypeError, Exception):
            return False


def get_project_root() -> Path:
    """Compute the fixed project root anchor regardless of current working directory.
    
    Checks environment variables first, then searches parent directories of this file
    for the project root containing 'backend' and 'data'.
    """
    env_root = os.environ.get("TRUST_CV_ROOT") or os.environ.get("PROJECT_ROOT")
    if env_root:
        return Path(env_root).resolve()
    
    signer_path = Path(__file__).resolve()
    for parent in signer_path.parents:
        if (parent / "backend").is_dir() and ((parent / "data").is_dir() or (parent / "requirements.txt").is_file()):
            return parent
            
    # Default fixed anchor: 3 levels up from signer.py is backend root
    return signer_path.parent.parent.parent


def get_resolved_keys_dir() -> Path:
    """Resolve the keys directory as an absolute path guaranteed to be invariant to cwd."""
    env_keys = os.environ.get("TRUST_CV_KEYS_DIR")
    if env_keys:
        return Path(env_keys).resolve()
        
    try:
        from app.core.config import settings
        raw_data_dir = settings.DATA_DIR
    except Exception as exc:
        project_root = get_project_root()
        fallback_dir = (project_root / "data" / "keys").resolve()
        logger.warning(
            "Failed to import app.core.config.settings (%s: %s). "
            "Falling back to fixed project anchor path: %s",
            type(exc).__name__, exc, fallback_dir
        )
        return fallback_dir

    data_path = Path(raw_data_dir)
    if data_path.is_absolute():
        return (data_path / "keys").resolve()
    
    # Resolve relative path against fixed project root anchor, NEVER bare os.getcwd()
    project_root = get_project_root()
    clean_relative = raw_data_dir.lstrip("./") if raw_data_dir.startswith("./") else raw_data_dir
    return (project_root / clean_relative / "keys").resolve()


def check_ledger_for_signed_events() -> Tuple[int, Optional[Path]]:
    """Check if the ledger database contains any signed events."""
    try:
        from app.core.config import settings
        raw_db_url = settings.LEDGER_SQLITE_URL
    except Exception as exc:
        logger.warning("Could not read settings.LEDGER_SQLITE_URL (%s: %s)", type(exc).__name__, exc)
        raw_db_url = "sqlite:///./data/ledger/ledger.db"

    db_path: Optional[Path] = None
    if raw_db_url.startswith("sqlite:///"):
        path_str = raw_db_url[len("sqlite:///"):]
        if path_str == ":memory:":
            return 0, None
        p = Path(path_str)
        if p.is_absolute():
            db_path = p
        else:
            project_root = get_project_root()
            clean_rel = path_str.lstrip("./") if path_str.startswith("./") else path_str
            db_path = (project_root / clean_rel).resolve()
    
    if not db_path or not db_path.exists():
        return 0, db_path

    try:
        import sqlite3
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_events'")
        if not cursor.fetchone():
            conn.close()
            return 0, db_path
        cursor.execute("SELECT COUNT(*) FROM ledger_events WHERE signature IS NOT NULL AND signature != ''")
        row = cursor.fetchone()
        count = row[0] if row else 0
        conn.close()
        return count, db_path
    except Exception as e:
        logger.debug("Could not inspect ledger DB for signed events: %s", e)
        return 0, db_path


_startup_key_mismatch_warning_logged: bool = False


def get_or_create_persistent_key_manager(custom_keys_dir: Optional[Path] = None) -> KeyManager:
    """Load or generate a persistent system KeyManager so signatures survive process restarts.
    
    Guarantees absolute path resolution invariant to process working directory.
    """
    global _startup_key_mismatch_warning_logged
    if custom_keys_dir is not None:
        keys_dir = Path(custom_keys_dir).resolve()
    else:
        keys_dir = get_resolved_keys_dir()
    
    keys_dir.mkdir(parents=True, exist_ok=True)
    priv_key_file = keys_dir / "system_private_key.pem"

    if priv_key_file.exists():
        try:
            pem_bytes = priv_key_file.read_bytes()
            km = KeyManager(private_key_pem=pem_bytes)
            logger.info("Loaded persistent system KeyManager from %s (fingerprint: %s)", priv_key_file, km.fingerprint)
            return km
        except Exception as exc:
            logger.warning("Failed to load existing key from %s (%s). Generating new key.", priv_key_file, exc)

    # Key file does NOT exist at resolved path. Check if ledger DB already has signed events.
    signed_count, ledger_db_path = check_ledger_for_signed_events()
    if signed_count > 0:
        _startup_key_mismatch_warning_logged = True
        logger.warning(
            "================================================================================\n"
            "[!] CRITICAL WARNING: KEY / LEDGER MISMATCH DETECTED!\n"
            "    No private key found at resolved path: %s\n"
            "    However, the ledger database at: %s\n"
            "    already contains %d signed event(s)!\n"
            "    Generating a new keypair now will cause future chain verifications to report\n"
            "    'KEY_ROTATION' on all %d existing signed events.\n"
            "    RECOMMENDED ACTION:\n"
            "    - Either restore the original 'system_private_key.pem' to %s\n"
            "    - Or reset the ledger database for a clean demo state.\n"
            "================================================================================",
            priv_key_file, ledger_db_path, signed_count, signed_count, keys_dir
        )

    km = KeyManager()
    try:
        priv_key_file.write_bytes(km.export_private_key_pem())
        logger.info("Generated new persistent system KeyManager at %s (fingerprint: %s)", priv_key_file, km.fingerprint)
    except Exception as exc:
        logger.error("Failed to write persistent private key to %s: %s", priv_key_file, exc)
    return km


def verify_startup_key_consistency() -> None:
    """Startup consistency check verifying key and ledger alignment."""
    signed_count, ledger_db_path = check_ledger_for_signed_events()
    keys_dir = get_resolved_keys_dir()
    priv_key_file = keys_dir / "system_private_key.pem"
    
    if _startup_key_mismatch_warning_logged or (signed_count > 0 and not priv_key_file.exists()):
        logger.warning(
            "STARTUP CONSISTENCY CHECK WARNING: Ledger at %s contains %d signed events, "
            "but active key was generated freshly without the previous private key file. "
            "Ledger verification will report KEY_ROTATION until keys are aligned or ledger reset.",
            ledger_db_path, signed_count
        )


# Singleton instance for system-level signature generation (persisted across restarts)
default_key_manager = get_or_create_persistent_key_manager()
default_signer = default_key_manager
Signer = KeyManager
