"""Profiles: CRUD, frozen fingerprints, clone/regenerate and launch specs."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from app.config import Settings
from app.db import Database, new_id, now_iso
from app.engines.base import LaunchSpec, ProxyCredentials
from app.models import (
    CloneRequest,
    Geo,
    GeoOverride,
    LaunchOptions,
    Profile,
    ProfileCreate,
    ProfileDetail,
    ProfileUpdate,
    RegenerateRequest,
)
from app.services.fingerprints import FingerprintService
from app.services.proxies import ProxyNotFound, ProxyService


class ProfileNotFound(LookupError):
    pass


class ProfileBusy(RuntimeError):
    """The profile is running and the operation needs it stopped."""


class ProfileService:
    def __init__(
        self,
        db: Database,
        settings: Settings,
        fingerprints: FingerprintService,
        proxies: ProxyService,
    ):
        self.db = db
        self.settings = settings
        self.fingerprints = fingerprints
        self.proxies = proxies

    # -- paths ------------------------------------------------------------------
    def profile_dir(self, profile_id: str) -> Path:
        return self.settings.profiles_dir / profile_id

    def user_data_dir(self, profile_id: str) -> Path:
        return self.profile_dir(profile_id) / "user-data"

    # -- crud -------------------------------------------------------------------
    def create(self, data: ProfileCreate) -> ProfileDetail:
        if data.proxy_id:
            self.proxies.get(data.proxy_id)  # raises ProxyNotFound
        pid = new_id()
        fp = self.fingerprints.generate(data.os, data.screen, data.launch_options.window)
        target_os = fp.get("_meta", {}).get("target_os", data.os or "windows")
        self.db.execute(
            """INSERT INTO profiles(id,name,group_name,tags,notes,engine,os,fingerprint,proxy_id,
               geo_override,launch_options,created_at,status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'stopped')""",
            (
                pid,
                data.name,
                data.group_name,
                json.dumps(data.tags),
                data.notes,
                self.settings.engine,
                target_os,
                json.dumps(fp),
                data.proxy_id,
                data.geo_override.model_dump_json() if data.geo_override else None,
                data.launch_options.model_dump_json(),
                now_iso(),
            ),
        )
        self.user_data_dir(pid).mkdir(parents=True, exist_ok=True)
        self.db.record_event("profile.created", pid, name=data.name, os=target_os)
        return self.get(pid)

    def _row(self, profile_id: str) -> Any:
        row = self.db.fetchone("SELECT * FROM profiles WHERE id=?", (profile_id,))
        if not row:
            raise ProfileNotFound(profile_id)
        return row

    def get(self, profile_id: str, running: dict[str, Any] | None = None) -> ProfileDetail:
        return self._to_detail(self._row(profile_id), running or {})

    def list(
        self,
        group: str | None = None,
        tag: str | None = None,
        status: str | None = None,
        running: dict[str, Any] | None = None,
    ) -> list[Profile]:
        sql = "SELECT * FROM profiles WHERE 1=1"
        params: list[Any] = []
        if group:
            sql += " AND group_name=?"
            params.append(group)
        if status:
            sql += " AND status=?"
            params.append(status)
        sql += " ORDER BY created_at DESC"
        rows = self.db.fetchall(sql, tuple(params))
        out = []
        for r in rows:
            if tag and tag not in json.loads(r["tags"] or "[]"):
                continue
            out.append(self._to_model(r, running or {}))
        return out

    def groups(self) -> list[str]:
        rows = self.db.fetchall(
            "SELECT DISTINCT group_name FROM profiles WHERE group_name IS NOT NULL ORDER BY 1"
        )
        return [r["group_name"] for r in rows]

    def update(self, profile_id: str, data: ProfileUpdate) -> tuple[ProfileDetail, bool]:
        """Apply ``data``. Returns ``(profile, proxy_or_geo_changed)``."""
        self._row(profile_id)
        fields = data.model_dump(exclude_unset=True)
        sets: list[str] = []
        params: list[Any] = []
        proxy_changed = False
        for key, value in fields.items():
            if key in ("clear_proxy", "clear_geo_override"):
                continue
            if key == "tags":
                sets.append("tags=?")
                params.append(json.dumps(value))
            elif key == "proxy_id":
                if value:
                    self.proxies.get(value)
                sets.append("proxy_id=?")
                params.append(value)
                proxy_changed = True
            elif key == "geo_override":
                sets.append("geo_override=?")
                params.append(json.dumps(value) if value else None)
                proxy_changed = True
            elif key == "launch_options":
                sets.append("launch_options=?")
                params.append(json.dumps(value))
            else:
                sets.append(f"{key}=?")
                params.append(value)
        if data.clear_proxy:
            sets.append("proxy_id=NULL")
            proxy_changed = True
        if data.clear_geo_override:
            sets.append("geo_override=NULL")
            proxy_changed = True
        if sets:
            params.append(profile_id)
            self.db.execute(f"UPDATE profiles SET {', '.join(sets)} WHERE id=?", tuple(params))
        self.db.record_event(
            "profile.updated", profile_id, fields=list(fields), proxy_changed=proxy_changed
        )
        return self.get(profile_id), proxy_changed

    def delete(self, profile_id: str, delete_data: bool = True) -> None:
        self._row(profile_id)
        self.db.execute("DELETE FROM profiles WHERE id=?", (profile_id,))
        if delete_data:
            shutil.rmtree(self.profile_dir(profile_id), ignore_errors=True)
        self.db.record_event("profile.deleted", profile_id, data_deleted=delete_data)

    def clone(self, profile_id: str, req: CloneRequest) -> ProfileDetail:
        """New id, **new** fingerprint, same settings. Cookies are copied by the API layer."""
        src = self._row(profile_id)
        data = ProfileCreate(
            name=req.name or f"{src['name']} (copy)",
            group_name=src["group_name"],
            tags=json.loads(src["tags"] or "[]"),
            notes=src["notes"],
            os=src["os"],
            proxy_id=src["proxy_id"],
            geo_override=GeoOverride(**json.loads(src["geo_override"]))
            if src["geo_override"]
            else None,
            launch_options=LaunchOptions(**json.loads(src["launch_options"] or "{}")),
        )
        new = self.create(data)
        self.db.record_event("profile.cloned", new.id, source=profile_id)
        return new

    def regenerate_fingerprint(self, profile_id: str, req: RegenerateRequest) -> ProfileDetail:
        row = self._row(profile_id)
        opts = LaunchOptions(**json.loads(row["launch_options"] or "{}"))
        fp = self.fingerprints.generate(req.os or row["os"], req.screen, opts.window)
        self.db.execute(
            "UPDATE profiles SET fingerprint=?, os=? WHERE id=?",
            (json.dumps(fp), fp.get("_meta", {}).get("target_os", row["os"]), profile_id),
        )
        self.db.record_event("profile.fingerprint_regenerated", profile_id)
        return self.get(profile_id)

    def fingerprint(self, profile_id: str) -> dict[str, Any]:
        return json.loads(self._row(profile_id)["fingerprint"])

    def set_status(self, profile_id: str, status: str, touch: bool = False) -> None:
        if touch:
            self.db.execute(
                "UPDATE profiles SET status=?, last_used_at=? WHERE id=?",
                (status, now_iso(), profile_id),
            )
        else:
            self.db.execute("UPDATE profiles SET status=? WHERE id=?", (status, profile_id))

    def set_engine_version(self, profile_id: str, version: str | None) -> None:
        if version:
            self.db.execute(
                "UPDATE profiles SET engine_version=COALESCE(engine_version, ?) WHERE id=?",
                (version, profile_id),
            )

    # -- launch spec -----------------------------------------------------------------
    def resolve_geo(self, row: Any, proxy_geo: Geo | None) -> Geo | None:
        """Proxy-derived geo, with the profile's manual override on top."""
        geo = proxy_geo.model_copy() if proxy_geo else None
        if row["geo_override"]:
            ov = GeoOverride(**json.loads(row["geo_override"]))
            geo = geo or Geo()
            for key in ("timezone", "locale", "latitude", "longitude"):
                val = getattr(ov, key)
                if val is not None:
                    setattr(geo, key, val)
            if ov.locale and "-" in ov.locale and not geo.country:
                geo.country = ov.locale.split("-")[-1].upper()
        return geo

    def build_launch_spec(
        self,
        profile_id: str,
        *,
        headless: bool = False,
        proxy: ProxyCredentials | None = None,
        exit_ip: str | None = None,
        proxy_geo: Geo | None = None,
    ) -> LaunchSpec:
        row = self._row(profile_id)
        return LaunchSpec(
            profile_id=profile_id,
            name=row["name"],
            user_data_dir=self.user_data_dir(profile_id),
            fingerprint=json.loads(row["fingerprint"]),
            os=row["os"],
            options=LaunchOptions(**json.loads(row["launch_options"] or "{}")),
            proxy=proxy,
            exit_ip=exit_ip,
            geo=self.resolve_geo(row, proxy_geo),
            headless=headless,
            engine_version=row["engine_version"],
        )

    # -- mapping ---------------------------------------------------------------------
    def _to_model(self, row: Any, running: dict[str, Any]) -> Profile:
        fp = json.loads(row["fingerprint"])
        proxy = None
        if row["proxy_id"]:
            try:
                proxy = self.proxies.get(row["proxy_id"])
            except ProxyNotFound:
                proxy = None
        last = self.db.fetchone(
            "SELECT passed, ran_at FROM selftests WHERE profile_id=? ORDER BY ran_at DESC LIMIT 1",
            (row["id"],),
        )
        handle = running.get(row["id"])
        return Profile(
            id=row["id"],
            name=row["name"],
            group_name=row["group_name"],
            tags=json.loads(row["tags"] or "[]"),
            notes=row["notes"],
            engine=row["engine"],
            os=row["os"],
            fingerprint_summary=self.fingerprints.summarize(fp),
            proxy_id=row["proxy_id"],
            proxy=proxy,
            geo_override=GeoOverride(**json.loads(row["geo_override"]))
            if row["geo_override"]
            else None,
            launch_options=LaunchOptions(**json.loads(row["launch_options"] or "{}")),
            engine_version=row["engine_version"],
            created_at=row["created_at"],
            last_used_at=row["last_used_at"],
            status="running" if handle else row["status"],
            ws_endpoint=getattr(handle, "ws_endpoint", None),
            pid=getattr(handle, "pid", None),
            last_selftest_passed=None if not last else bool(last["passed"]),
            last_selftest_at=None if not last else last["ran_at"],
        )

    def _to_detail(self, row: Any, running: dict[str, Any]) -> ProfileDetail:
        base = self._to_model(row, running)
        return ProfileDetail(**base.model_dump(), fingerprint=json.loads(row["fingerprint"]))
