"""Secrets at rest.

* The **master key** lives in the OS credential store (Windows Credential
  Manager via ``keyring``). It is generated on first use and never written to
  the data directory. ``MULTIPROFILE_MASTER_KEY`` (base64) overrides it, which
  tests use and which lets a headless server run without a keyring backend.
* Small secrets (proxy passwords) are sealed with libsodium ``SecretBox``.
* Large blobs (profile backups) use libsodium's **secretstream** with a key
  derived from a user passphrase (argon2id), so a backup restores on another
  machine that never had the master key.
"""

from __future__ import annotations

import base64
import logging
import os
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

import nacl.bindings as sodium
import nacl.pwhash
import nacl.secret
import nacl.utils

log = logging.getLogger(__name__)

KEYRING_SERVICE = "MultiProfile"
KEYRING_USER = "master-key"
ENV_KEY = "MULTIPROFILE_MASTER_KEY"
KEY_BYTES = nacl.secret.SecretBox.KEY_SIZE  # 32

# Backup container format -------------------------------------------------------
MAGIC = b"MPBK"
FORMAT_VERSION = 1
CHUNK = 1 << 20  # 1 MiB plaintext per secretstream message
SALT_BYTES = nacl.pwhash.argon2id.SALTBYTES
HEADER_STRUCT = struct.Struct(">4sBQQ")  # magic, version, opslimit, memlimit


class VaultError(RuntimeError):
    pass


class Vault:
    def __init__(self, master_key: bytes | None = None, *, key_file: Path | None = None):
        """``key_file`` is a last-resort fallback when no keyring backend exists.

        It is only used if neither the env var nor the keyring can provide a
        key, and it is created with mode 0600. The daemon logs a warning.
        """
        self._key_file = key_file
        self._key = master_key or self._load_master_key()
        if len(self._key) != KEY_BYTES:
            raise VaultError("master key must be 32 bytes")
        self._box = nacl.secret.SecretBox(self._key)

    # -- master key ------------------------------------------------------------
    def _load_master_key(self) -> bytes:
        raw = os.environ.get(ENV_KEY)
        if raw:
            return base64.b64decode(raw)
        try:
            import keyring

            stored = keyring.get_password(KEYRING_SERVICE, KEYRING_USER)
            if stored:
                return base64.b64decode(stored)
            key = nacl.utils.random(KEY_BYTES)
            keyring.set_password(KEYRING_SERVICE, KEYRING_USER, base64.b64encode(key).decode())
            # Read back to make sure the backend really persisted it.
            if keyring.get_password(KEYRING_SERVICE, KEYRING_USER):
                return key
            raise VaultError("keyring did not persist the master key")
        except Exception as exc:  # noqa: BLE001 - any backend failure falls through
            if self._key_file is None:
                raise VaultError(f"no usable keyring backend and no key file: {exc}") from exc
            log.warning(
                "No OS credential store available (%s). Falling back to key file %s",
                exc,
                self._key_file,
            )
            return self._load_or_create_key_file(self._key_file)

    @staticmethod
    def _load_or_create_key_file(path: Path) -> bytes:
        if path.exists():
            return base64.b64decode(path.read_text(encoding="utf-8").strip())
        key = nacl.utils.random(KEY_BYTES)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(base64.b64encode(key).decode(), encoding="utf-8")
        if os.name == "posix":
            os.chmod(path, 0o600)
        return key

    # -- small secrets ---------------------------------------------------------
    def encrypt(self, plaintext: str | bytes) -> bytes:
        data = plaintext.encode("utf-8") if isinstance(plaintext, str) else plaintext
        return bytes(self._box.encrypt(data))

    def decrypt(self, ciphertext: bytes | memoryview | None) -> bytes | None:
        if ciphertext is None:
            return None
        try:
            return self._box.decrypt(bytes(ciphertext))
        except Exception as exc:  # nacl.exceptions.CryptoError
            raise VaultError("could not decrypt secret (wrong master key?)") from exc

    def decrypt_str(self, ciphertext: bytes | memoryview | None) -> str | None:
        data = self.decrypt(ciphertext)
        return None if data is None else data.decode("utf-8")


# -- passphrase-encrypted streams (backups) --------------------------------------
def _derive_key(passphrase: str, salt: bytes, ops: int, mem: int) -> bytes:
    return nacl.pwhash.argon2id.kdf(
        KEY_BYTES, passphrase.encode("utf-8"), salt, opslimit=ops, memlimit=mem
    )


def encrypt_stream(
    src: BinaryIO,
    dst: BinaryIO,
    passphrase: str,
    *,
    ops: int = nacl.pwhash.argon2id.OPSLIMIT_MODERATE,
    mem: int = nacl.pwhash.argon2id.MEMLIMIT_MODERATE,
) -> None:
    """Encrypt ``src`` into ``dst`` in 1 MiB authenticated chunks."""
    salt = nacl.utils.random(SALT_BYTES)
    key = _derive_key(passphrase, salt, ops, mem)
    state = sodium.crypto_secretstream_xchacha20poly1305_state()
    header = sodium.crypto_secretstream_xchacha20poly1305_init_push(state, key)
    dst.write(HEADER_STRUCT.pack(MAGIC, FORMAT_VERSION, ops, mem))
    dst.write(salt)
    dst.write(header)
    chunk = src.read(CHUNK)
    while True:
        nxt = src.read(CHUNK)
        final = not nxt
        tag = (
            sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
            if final
            else sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
        )
        ct = sodium.crypto_secretstream_xchacha20poly1305_push(state, chunk, tag=tag)
        dst.write(struct.pack(">I", len(ct)))
        dst.write(ct)
        if final:
            break
        chunk = nxt


def decrypt_stream_iter(src: BinaryIO, passphrase: str) -> Iterator[bytes]:
    head = src.read(HEADER_STRUCT.size)
    if len(head) != HEADER_STRUCT.size:
        raise VaultError("not a MultiProfile backup (short header)")
    magic, version, ops, mem = HEADER_STRUCT.unpack(head)
    if magic != MAGIC or version != FORMAT_VERSION:
        raise VaultError("not a MultiProfile backup (bad magic/version)")
    salt = src.read(SALT_BYTES)
    header = src.read(sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES)
    key = _derive_key(passphrase, salt, ops, mem)
    state = sodium.crypto_secretstream_xchacha20poly1305_state()
    try:
        sodium.crypto_secretstream_xchacha20poly1305_init_pull(state, header, key)
    except Exception as exc:
        raise VaultError("could not open backup") from exc
    while True:
        lenb = src.read(4)
        if len(lenb) != 4:
            raise VaultError("backup truncated")
        (n,) = struct.unpack(">I", lenb)
        ct = src.read(n)
        if len(ct) != n:
            raise VaultError("backup truncated")
        try:
            pt, tag = sodium.crypto_secretstream_xchacha20poly1305_pull(state, ct)
        except Exception as exc:
            raise VaultError("wrong passphrase or corrupted backup") from exc
        yield pt
        if tag == sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL:
            return


def decrypt_stream(src: BinaryIO, dst: BinaryIO, passphrase: str) -> None:
    for chunk in decrypt_stream_iter(src, passphrase):
        dst.write(chunk)
