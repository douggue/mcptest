import io
import os

import pytest

from app.vault import Vault, VaultError, decrypt_stream, encrypt_stream
from tests.conftest import MASTER_KEY


def test_secret_round_trip():
    v = Vault(master_key=MASTER_KEY)
    ct = v.encrypt("hunter2")
    assert b"hunter2" not in ct
    assert v.decrypt_str(ct) == "hunter2"
    assert v.decrypt(None) is None


def test_wrong_key_fails():
    ct = Vault(master_key=MASTER_KEY).encrypt("x")
    with pytest.raises(VaultError):
        Vault(master_key=bytes(32)).decrypt(ct)


def test_key_file_fallback(tmp_path, monkeypatch):
    monkeypatch.delenv("MULTIPROFILE_MASTER_KEY", raising=False)
    monkeypatch.setattr(
        "keyring.get_password", lambda *_: (_ for _ in ()).throw(RuntimeError("no backend"))
    )
    kf = tmp_path / "master.key"
    v1 = Vault(key_file=kf)
    v2 = Vault(key_file=kf)
    assert v2.decrypt_str(v1.encrypt("same key")) == "same key"
    if os.name == "posix":
        assert oct(kf.stat().st_mode & 0o777) == "0o600"


def test_env_key(monkeypatch):
    import base64

    monkeypatch.setenv("MULTIPROFILE_MASTER_KEY", base64.b64encode(MASTER_KEY).decode())
    assert Vault().decrypt_str(Vault(master_key=MASTER_KEY).encrypt("a")) == "a"


@pytest.mark.parametrize(
    "size", [0, 1, 1024, (1 << 20) - 1, 1 << 20, (1 << 20) + 1, 3 * (1 << 20) + 17]
)
def test_stream_round_trip(size):
    data = os.urandom(size)
    enc = io.BytesIO()
    encrypt_stream(io.BytesIO(data), enc, "correct horse", ops=1, mem=8192)
    enc.seek(0)
    out = io.BytesIO()
    decrypt_stream(enc, out, "correct horse")
    assert out.getvalue() == data


def test_stream_wrong_passphrase_and_tamper():
    enc = io.BytesIO()
    encrypt_stream(io.BytesIO(b"payload" * 1000), enc, "right", ops=1, mem=8192)
    with pytest.raises(VaultError):
        decrypt_stream(io.BytesIO(enc.getvalue()), io.BytesIO(), "wrong")
    tampered = bytearray(enc.getvalue())
    tampered[-5] ^= 0xFF
    with pytest.raises(VaultError):
        decrypt_stream(io.BytesIO(bytes(tampered)), io.BytesIO(), "right")
    with pytest.raises(VaultError):
        decrypt_stream(io.BytesIO(b"not a backup"), io.BytesIO(), "right")
