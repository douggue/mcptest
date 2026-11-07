"""Pydantic schemas shared by the API and the services."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

OSName = Literal["windows", "macos", "linux"]
ProxyScheme = Literal["http", "https", "socks5"]
WebRTCMode = Literal["proxy", "block"]


# -- geo ---------------------------------------------------------------------
class Geo(BaseModel):
    country: str | None = None
    region: str | None = None
    city: str | None = None
    timezone: str | None = None
    locale: str | None = None  # BCP-47, e.g. "en-US"
    latitude: float | None = None
    longitude: float | None = None
    accuracy: float | None = None


class GeoOverride(BaseModel):
    """Manual values that win over the proxy-derived geo."""

    timezone: str | None = None
    locale: str | None = None
    latitude: float | None = None
    longitude: float | None = None


# -- proxies -------------------------------------------------------------------
class ProxyCreate(BaseModel):
    label: str | None = None
    scheme: ProxyScheme = "http"
    host: str
    port: int = Field(ge=1, le=65535)
    username: str | None = None
    password: str | None = None
    sticky: bool = True


class ProxyUpdate(BaseModel):
    label: str | None = None
    scheme: ProxyScheme | None = None
    host: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = None
    password: str | None = None
    sticky: bool | None = None


class Proxy(BaseModel):
    id: str
    label: str | None
    scheme: ProxyScheme
    host: str
    port: int
    username: str | None
    has_password: bool
    sticky: bool
    last_exit_ip: str | None
    last_geo: Geo | None
    last_latency_ms: float | None
    last_checked_at: str | None
    last_error: str | None
    healthy: bool | None
    created_at: str
    profile_count: int = 0


class ProxyCheckResult(BaseModel):
    proxy_id: str
    healthy: bool
    exit_ip: str | None = None
    geo: Geo | None = None
    latency_ms: float | None = None
    error: str | None = None
    shared_with: list[str] = Field(
        default_factory=list, description="other proxies on same exit IP"
    )


class ProxyBulkImport(BaseModel):
    text: str = Field(
        description="one proxy per line, scheme://user:pass@host:port or host:port:user:pass"
    )
    default_scheme: ProxyScheme = "http"
    label_prefix: str | None = None


# -- profiles ------------------------------------------------------------------
class ScreenConstraints(BaseModel):
    min_width: int | None = None
    max_width: int | None = None
    min_height: int | None = None
    max_height: int | None = None


class LaunchOptions(BaseModel):
    """Per-profile launch settings (stored, editable)."""

    window: tuple[int, int] | None = None
    webrtc: WebRTCMode = "proxy"
    block_images: bool = False
    humanize: bool = False
    extensions: list[str] = Field(default_factory=list, description="paths to Firefox .xpi files")
    start_url: str | None = None


class ProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    group_name: str | None = None
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None
    os: OSName | None = Field(default=None, description="defaults to the host OS")
    screen: ScreenConstraints | None = None
    proxy_id: str | None = None
    geo_override: GeoOverride | None = None
    launch_options: LaunchOptions = Field(default_factory=LaunchOptions)


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    group_name: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    proxy_id: str | None = None
    clear_proxy: bool = False
    geo_override: GeoOverride | None = None
    clear_geo_override: bool = False
    launch_options: LaunchOptions | None = None


class FingerprintSummary(BaseModel):
    user_agent: str | None = None
    platform: str | None = None
    os: str | None = None
    browser_version: str | None = None
    screen: str | None = None
    window: str | None = None
    hardware_concurrency: int | None = None
    languages: list[str] = Field(default_factory=list)
    gpu_vendor: str | None = None
    gpu_renderer: str | None = None
    timezone: str | None = None


class Profile(BaseModel):
    id: str
    name: str
    group_name: str | None
    tags: list[str]
    notes: str | None
    engine: str
    os: str
    fingerprint_summary: FingerprintSummary
    proxy_id: str | None
    proxy: Proxy | None = None
    geo_override: GeoOverride | None
    launch_options: LaunchOptions
    engine_version: str | None
    created_at: str
    last_used_at: str | None
    status: str
    ws_endpoint: str | None = None
    pid: int | None = None
    last_selftest_passed: bool | None = None
    last_selftest_at: str | None = None


class ProfileDetail(Profile):
    fingerprint: dict[str, Any]


class CloneRequest(BaseModel):
    name: str | None = None
    copy_cookies: bool = False


class RegenerateRequest(BaseModel):
    os: OSName | None = None
    screen: ScreenConstraints | None = None


class StartResponse(BaseModel):
    profile_id: str
    ws_endpoint: str
    pid: int | None
    already_running: bool = False


class RunningProfile(BaseModel):
    profile_id: str
    name: str
    ws_endpoint: str
    pid: int | None
    started_at: str


# -- cookies -------------------------------------------------------------------
class Cookie(BaseModel):
    name: str
    value: str
    domain: str
    path: str = "/"
    expires: float | None = None  # unix seconds, None = session
    http_only: bool = False
    secure: bool = False
    same_site: Literal["Strict", "Lax", "None"] | None = None


class CookieImport(BaseModel):
    format: Literal["json", "netscape"] = "json"
    cookies: list[Cookie] | None = None
    text: str | None = Field(default=None, description="raw JSON or Netscape cookies.txt")


# -- self-test -------------------------------------------------------------------
class CheckResult(BaseModel):
    name: str
    passed: bool
    expected: Any = None
    actual: Any = None
    reason: str | None = None


class SelfTestReport(BaseModel):
    id: str | None = None
    profile_id: str
    ran_at: str
    passed: bool
    checks: list[CheckResult]
    external_pages: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None


# -- backup ----------------------------------------------------------------------
class BackupExportRequest(BaseModel):
    profile_ids: list[str] = Field(min_length=1)
    passphrase: str = Field(min_length=8)
    destination_dir: str | None = None


class BackupExportResult(BaseModel):
    files: list[str]


class BackupImportRequest(BaseModel):
    path: str
    passphrase: str
    new_id: bool = Field(default=False, description="always import as a fresh profile id")


class BackupImportResult(BaseModel):
    profile_id: str
    name: str
    replaced: bool


# -- misc ------------------------------------------------------------------------
class EngineStatus(BaseModel):
    engine: str
    browser_installed: bool
    browser_version: str | None = None
    install_in_progress: bool = False
    install_progress: float | None = None
    install_error: str | None = None


class Health(BaseModel):
    status: str = "ok"
    version: str
    pid: int
    data_dir: str
    running_profiles: int
