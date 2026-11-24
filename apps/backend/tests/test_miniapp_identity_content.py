"""Security regressions. Execution requires explicit pytest authorization; no real WeChat requests."""

import json
import logging
from io import StringIO
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import Response
from jwt import InvalidTokenError
from loguru import logger
from pydantic import ValidationError

from app.api.dependencies import require_consumer_profile
from app.core.config import Settings
from app.core.exceptions import AppException
from app.core.identifiers import new_uuid7
from app.core.logging import configure_logging
from app.core.payload_sanitizer import is_sensitive_route
from app.core.request_metadata import RequestMetadata
from app.core.restricted_html import legacy_text_to_html, restricted_html
from app.core.security import create_access_token, decode_access_token
from app.domains.auth.schemas import ConsumerRefreshIn, WechatLoginIn
from app.services.consumer_auth import ConsumerAuthService
from tests.conftest import TEST_SECRETS


def miniapp_settings(**changes: object) -> Settings:
    values = {
        "ENVIRONMENT": "local",
        "DATABASE_URL": "postgresql+asyncpg://u:p@localhost:5432/unit_only",
        **TEST_SECRETS,
        "MINIAPP_LOGIN_ENABLED": True,
        "WECHAT_APP_ID": "wx0123456789abcdef",
        "WECHAT_APP_SECRET": "unit-wechat-only-0000000000000001",
        "MINIAPP_JWT_SECRET": "unit-miniapp-jwt-0000000000000001",
        "MINIAPP_TOKEN_HMAC_KEY": "unit-miniapp-hmac-000000000000001",
        **changes,
    }
    return Settings.model_validate(values)


@pytest.mark.parametrize(
    "content",
    [
        "<script>alert(1)</script>",
        '<p onclick="alert(1)">x</p>',
        '<a href="https://example.com">x</a>',
        '<img src="https://example.com/a.png">',
        "<svg><script>x</script></svg>",
        '<p style="color:red;background:url(x)">x</p>',
        "<!--secret--><p>x</p>",
        "<p><strong>x</p>",
    ],
)
def test_description_rejects_unsafe_or_ambiguous_html(content: str) -> None:
    with pytest.raises(ValueError):
        restricted_html(content)


def test_text_migration_never_interprets_markup() -> None:
    result = legacy_text_to_html("<script>x</script>\n第二行")
    assert "<script>" not in result and "&lt;script&gt;" in result and "<br>" in result
    assert restricted_html(result) == result
    assert (
        restricted_html('<p><span style="color: rgb(180, 35, 24)">红色</span></p>')
        == '<p><span style="color: #b42318;">红色</span></p>'
    )


def test_profile_and_key_separation() -> None:
    settings = miniapp_settings()
    settings.validate_runtime()
    token, _ = create_access_token(
        subject_id=new_uuid7(),
        session_id=new_uuid7(),
        credential_version=1,
        audience="pinjie-miniapp",
        issuer=settings.jwt_issuer,
        secret=settings.miniapp_secrets()[0],
        ttl_seconds=60,
    )
    for audience, key in [
        ("pinjie-web", settings.authentication_secrets()[0]),
        ("pinjie-miniapp", settings.authentication_secrets()[0]),
        ("pinjie-admin", settings.miniapp_secrets()[0]),
    ]:
        with pytest.raises(InvalidTokenError):
            decode_access_token(token, audience=audience, issuer=settings.jwt_issuer, secret=key)
    with pytest.raises(ValueError):
        miniapp_settings(MINIAPP_JWT_SECRET=settings.web_jwt_secret).miniapp_secrets()
    request = MagicMock(headers={"cookie": "pinjie_web_access=unit-only"})
    with pytest.raises(AppException) as failure:
        require_consumer_profile(request, Response())
    assert failure.value.status_code == 400


def test_secrets_are_not_repr_or_error_body_candidates() -> None:
    assert "unit-code" not in repr(WechatLoginIn(code="unit-code"))
    assert "x" * 64 not in repr(ConsumerRefreshIn(refresh_token="x" * 64))
    assert is_sensitive_route("/api/v1/auth/login")
    assert is_sensitive_route("/api/v1/addresses")
    with pytest.raises(ValidationError):
        WechatLoginIn(code="unit", openid="client-forged")
    settings = miniapp_settings()
    configure_logging(settings)
    assert logging.getLogger("httpx").level >= logging.WARNING
    assert logging.getLogger("httpcore").level >= logging.WARNING


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        ("expired", None),
        ("server", None),
        ("malformed", "invalid_json"),
        ("timeout", "read_timeout"),
        ("connect", "connect_timeout"),
        ("write", "write_timeout"),
        ("pool", "pool_timeout"),
        ("deadline", "total_timeout"),
        ("connection", "connection_failed"),
        ("protocol", "http_error"),
    ],
)
async def test_exchange_failures_hide_external_payload(failure: str, reason: str | None) -> None:
    attempts = 0

    def transport(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        errors = {
            "timeout": httpx.ReadTimeout,
            "connect": httpx.ConnectTimeout,
            "write": httpx.WriteTimeout,
            "pool": httpx.PoolTimeout,
            "connection": httpx.ConnectError,
            "protocol": httpx.RemoteProtocolError,
        }
        if failure in errors:
            raise errors[failure]("unit-secret in external URL", request=request)
        if failure == "deadline":
            raise TimeoutError("unit-secret")
        if failure == "expired":
            return httpx.Response(200, json={"errcode": 40163, "errmsg": "unit-secret"})
        if failure == "malformed":
            return httpx.Response(200, content=b"unit-secret")
        return httpx.Response(500, json={"errmsg": "unit-secret"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        service = ConsumerAuthService(
            session=MagicMock(),
            session_factory=MagicMock(),
            redis=None,
            settings=miniapp_settings(),
            http=http,
            metadata=RequestMetadata(
                request_id=str(new_uuid7()),
                trace_id=str(new_uuid7()),
                ip_address="127.0.0.1",
                user_agent_summary="unit",
                release_version="unit",
            ),
        )
        output = StringIO()
        sink_id = logger.add(output, serialize=True)
        try:
            with pytest.raises(AppException) as rejected:
                await service._exchange("unit-code")
        finally:
            logger.remove(sink_id)
        assert "unit-secret" not in str(rejected.value)
        assert rejected.value.status_code == (401 if failure == "expired" else 503)
        assert attempts == 1
        logged = output.getvalue()
        for sensitive in ("unit-secret", "unit-code", service.settings.wechat_app_secret, "api.weixin.qq.com"):
            assert sensitive not in logged
        if reason is not None:
            record = json.loads(logged)["record"]
            assert record["exception"] is None
            assert record["extra"]["reason"] == reason
            assert record["extra"]["dependency"] == "wechat"
            assert record["extra"]["operation"] == "code2session"
            assert record["extra"]["request_id"] == service.metadata.request_id
            assert record["extra"]["trace_id"] == service.metadata.trace_id
            assert record["extra"]["duration_ms"] >= 0
        else:
            assert logged == ""


@pytest.mark.asyncio
async def test_exchange_accepts_only_trusted_openid() -> None:
    def transport(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.weixin.qq.com"
        assert request.url.params["grant_type"] == "authorization_code"
        assert request.extensions["timeout"] == {"connect": 10.0, "read": 4.0, "write": 4.0, "pool": 1.0}
        return httpx.Response(200, json={"openid": "unit-trusted-openid", "session_key": "never-store-this"})

    shared_timeout = httpx.Timeout(4.0, connect=2.0, pool=1.0)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport), timeout=shared_timeout) as http:
        service = ConsumerAuthService(
            session=MagicMock(),
            session_factory=MagicMock(),
            redis=None,
            settings=miniapp_settings(),
            http=http,
            metadata=RequestMetadata(
                request_id=str(new_uuid7()),
                trace_id=str(new_uuid7()),
                ip_address=None,
                user_agent_summary=None,
                release_version="unit",
            ),
        )
        identity = await service._exchange("unit-code")
        assert identity.openid == "unit-trusted-openid"
        assert "session_key" not in identity.model_dump()
        assert http.timeout == shared_timeout
