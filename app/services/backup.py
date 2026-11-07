"""Encrypted profile backups: one ``.mpbackup`` file per profile.

Layout inside the container (before encryption):
    tar (zstd-compressed) with
      profile.json   -- row metadata incl. fingerprint, proxy (with password) and options
      user-data/...  -- the Firefox profile directory

Encrypted with a passphrase (argon2id -> xchacha20-poly1305 secretstream),
so the archive restores on another machine that never had this one's master
key. The profile must be stopped while it is exported or imported.
"""

from __future__ import annotations

import io
import json
import shutil
import tarfile
import tempfile
from pathlib import Path
from typing import Any

import zstandard

from app.config import Settings
from app.db import Database, new_id, now_iso
from app.models import BackupImportResult, ProxyCreate
from app.services.launcher import LaunchManager
from app.services.profiles import ProfileBusy, ProfileNotFound, ProfileService
from app.services.proxies import ProxyService
from app.vault import VaultError, decrypt_stream_iter, encrypt_stream

EXT = ".mpbackup"
MANIFEST = "profile.json"
FORMAT = 1


class BackupError(RuntimeError):
    pass


class BackupService:
    def __init__(
        self,
        db: Database,
        settings: Settings,
        profiles: ProfileService,
        proxies: ProxyService,
        launcher: LaunchManager,
    ):
        self.db = db
        self.settings = settings
        self.profiles = profiles
        self.proxies = proxies
        self.launcher = launcher

    # -- export -------------------------------------------------------------------
    def export_profile(
        self, profile_id: str, passphrase: str, dest_dir: Path | None = None
    ) -> Path:
        if self.launcher.is_running(profile_id):
            raise ProfileBusy(f"stop profile {profile_id} before exporting it")
        row = self.profiles._row(profile_id)
        manifest: dict[str, Any] = {
            "format": FORMAT,
            "exported_at": now_iso(),
            "profile": {k: row[k] for k in row.keys()},  # noqa: SIM118 - sqlite3.Row
        }
        if row["proxy_id"]:
            try:
                creds = self.proxies.credentials(row["proxy_id"])
                proxy = self.proxies.get(row["proxy_id"])
                manifest["proxy"] = {
                    "label": proxy.label,
                    "scheme": creds.scheme,
                    "host": creds.host,
                    "port": creds.port,
                    "username": creds.username,
                    "password": creds.password,
                    "sticky": proxy.sticky,
                }
            except LookupError:
                pass
        dest_dir = dest_dir or self.settings.backups_dir
        dest_dir.mkdir(parents=True, exist_ok=True)
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in row["name"])[:40]
        out_path = dest_dir / f"{safe_name}-{profile_id}-{now_iso().replace(':', '')}{EXT}"

        with tempfile.NamedTemporaryFile(suffix=".tar.zst", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            cctx = zstandard.ZstdCompressor(level=6, threads=-1)
            with (
                open(tmp_path, "wb") as raw,
                cctx.stream_writer(raw) as zw,
                tarfile.open(fileobj=zw, mode="w|") as tar,
            ):
                data = json.dumps(manifest, default=str).encode("utf-8")
                info = tarfile.TarInfo(MANIFEST)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
                udd = self.profiles.user_data_dir(profile_id)
                if udd.exists():
                    tar.add(str(udd), arcname="user-data", filter=_skip_locks)
            with open(tmp_path, "rb") as src, open(out_path, "wb") as dst:
                encrypt_stream(src, dst, passphrase)
        finally:
            tmp_path.unlink(missing_ok=True)
        self.db.record_event("backup.exported", profile_id, path=str(out_path))
        return out_path

    def export_many(
        self, profile_ids: list[str], passphrase: str, dest_dir: Path | None
    ) -> list[Path]:
        return [self.export_profile(pid, passphrase, dest_dir) for pid in profile_ids]

    # -- import ---------------------------------------------------------------------
    def import_profile(
        self, path: Path, passphrase: str, *, new_id_always: bool = False
    ) -> BackupImportResult:
        if not path.exists():
            raise BackupError(f"{path} does not exist")
        with tempfile.TemporaryDirectory(prefix="mp-restore-") as tmpd:
            tmp = Path(tmpd)
            tar_path = tmp / "payload.tar.zst"
            try:
                with open(path, "rb") as src, open(tar_path, "wb") as dst:
                    for chunk in decrypt_stream_iter(src, passphrase):
                        dst.write(chunk)
            except VaultError as exc:
                raise BackupError(str(exc)) from exc
            extract_dir = tmp / "x"
            extract_dir.mkdir()
            dctx = zstandard.ZstdDecompressor()
            with (
                open(tar_path, "rb") as raw,
                dctx.stream_reader(raw) as zr,
                tarfile.open(fileobj=zr, mode="r|") as tar,
            ):
                tar.extractall(extract_dir, filter="data")
            manifest_path = extract_dir / MANIFEST
            if not manifest_path.exists():
                raise BackupError("backup has no profile.json")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            prow = manifest["profile"]
            old_id = prow["id"]

            replaced = False
            target_id = old_id
            exists = True
            try:
                self.profiles.get(old_id)
            except ProfileNotFound:
                exists = False
            if exists:
                if self.launcher.is_running(old_id):
                    raise ProfileBusy(f"profile {old_id} is running; stop it before restoring")
                if new_id_always:
                    target_id = new_id()
                else:
                    replaced = True

            proxy_id = self._restore_proxy(manifest.get("proxy"))
            if replaced:
                self.db.execute("DELETE FROM profiles WHERE id=?", (old_id,))
                shutil.rmtree(self.profiles.profile_dir(old_id), ignore_errors=True)
            self.db.execute(
                """INSERT INTO profiles(id,name,group_name,tags,notes,engine,os,fingerprint,
                   proxy_id,geo_override,launch_options,engine_version,created_at,last_used_at,
                   status)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'stopped')""",
                (
                    target_id,
                    prow["name"]
                    if not (exists and target_id != old_id)
                    else f"{prow['name']} (restored)",
                    prow.get("group_name"),
                    prow.get("tags") or "[]",
                    prow.get("notes"),
                    prow.get("engine") or "camoufox",
                    prow.get("os") or "windows",
                    prow["fingerprint"],
                    proxy_id,
                    prow.get("geo_override"),
                    prow.get("launch_options") or "{}",
                    prow.get("engine_version"),
                    prow.get("created_at") or now_iso(),
                    prow.get("last_used_at"),
                ),
            )
            dest = self.profiles.user_data_dir(target_id)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                shutil.rmtree(dest)
            src_udd = extract_dir / "user-data"
            if src_udd.exists():
                shutil.move(str(src_udd), str(dest))
            else:
                dest.mkdir(parents=True)
        self.db.record_event("backup.imported", target_id, source=str(path), replaced=replaced)
        return BackupImportResult(profile_id=target_id, name=prow["name"], replaced=replaced)

    def _restore_proxy(self, proxy: dict[str, Any] | None) -> str | None:
        if not proxy:
            return None
        # Reuse an identical proxy if we already have one.
        for p in self.proxies.list():
            if (
                p.scheme == proxy["scheme"]
                and p.host == proxy["host"]
                and p.port == proxy["port"]
                and (p.username or None) == (proxy.get("username") or None)
            ):
                return p.id
        created = self.proxies.create(
            ProxyCreate(
                label=proxy.get("label"),
                scheme=proxy["scheme"],
                host=proxy["host"],
                port=proxy["port"],
                username=proxy.get("username"),
                password=proxy.get("password"),
                sticky=bool(proxy.get("sticky", True)),
            )
        )
        return created.id


def _skip_locks(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
    name = Path(info.name).name
    if name in {"lock", ".parentlock", "parent.lock"}:
        return None
    return info
