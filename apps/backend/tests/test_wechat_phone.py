"""Phone proof regressions. Execution requires explicit pytest authorization."""

import asyncio
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException
from app.services import wechat_phone
from app.services.wechat_phone import PhoneInfo, WechatPhoneClient
from tests.test_miniapp_identity_content import miniapp_settings


def phone_payload(**changes):
    return {
        "phoneNumber": "13800138000",
        "purePhoneNumber": "13800138000",
        "countryCode": "86",
        "watermark": {"appid": "wx0123456789abcdef", "timestamp": int(datetime.now(UTC).timestamp())},
        **changes,
    }


@pytest.mark.parametrize(
    "changes",
    [
        {"countryCode": "+86"},
        {"purePhoneNumber": "abc"},
        {"phoneNumber": "13900139000"},
        {"watermark": {"appid": "another-app", "timestamp": int(datetime.now(UTC).timestamp())}},
        {"watermark": {"appid": "wx0123456789abcdef", "timestamp": 1}},
    ],
)
def test_rejects_invalid_phone_proof(changes):
    with pytest.raises(ValueError):
        PhoneInfo.model_validate(phone_payload(**changes)).normalized("wx0123456789abcdef", datetime.now(UTC))


def test_international_phone_preserves_country_code():
    proof = PhoneInfo.model_validate(
        phone_payload(countryCode="44", purePhoneNumber="7700900123", phoneNumber="447700900123")
    )
    assert proof.normalized("wx0123456789abcdef", datetime.now(UTC)) == "+447700900123"


@pytest.mark.asyncio
async def test_exchange_sends_trusted_openid_and_rejects_replay():
    redis = AsyncMock()
    redis.get.return_value = json.dumps({"access_token": "unit-token", "expires_in": 7200})
    redis.set.side_effect = [True, False]
    requests = []

    def handler(request):
        requests.append(request)
        assert json.loads(request.content) == {"code": "unit-phone-code", "openid": "trusted-subject"}
        assert request.extensions["timeout"]["connect"] == 10.0
        return httpx.Response(200, json={"errcode": 0, "phone_info": phone_payload()})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = WechatPhoneClient(miniapp_settings(), redis, http)
        assert await client.exchange("unit-phone-code", "trusted-subject") == "+8613800138000"
        with pytest.raises(AppException) as failure:
            await client.exchange("unit-phone-code", "trusted-subject")
        assert failure.value.code == ErrorCode.PHONE_CODE_INVALID
        assert len(requests) == 1


@pytest.mark.asyncio
async def test_timeout_is_unknown_and_does_not_retry_or_leak_secrets():
    redis = AsyncMock()
    redis.get.return_value = json.dumps({"access_token": "unit-secret-token", "expires_in": 7200})
    redis.set.return_value = True
    requests = []

    def handler(request):
        requests.append(request)
        raise httpx.ReadTimeout("unit-secret-token", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(AppException) as failure:
            await WechatPhoneClient(miniapp_settings(), redis, http).exchange("unit-code", "subject")
        assert failure.value.code == ErrorCode.PHONE_BINDING_UNKNOWN
        assert "unit-secret-token" not in str(failure.value)
        assert len(requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("timeout_operation", "error_code", "request_count", "redis_set_count"),
    [
        ("stable_token", ErrorCode.SERVICE_UNAVAILABLE, 1, 1),
        ("getuserphonenumber", ErrorCode.PHONE_BINDING_UNKNOWN, 2, 3),
    ],
)
async def test_cold_phone_exchange_times_out_by_stage(
    monkeypatch, timeout_operation, error_code, request_count, redis_set_count
):
    monkeypatch.setattr(wechat_phone, "_PHONE_EXCHANGE_BUDGET", 0.1)
    redis = AsyncMock()
    redis.get.return_value = None
    redis.set.return_value = True
    requests = []

    async def handler(request):
        requests.append(request)
        assert request.extensions["timeout"]["connect"] == 10.0
        if request.url.path.endswith(timeout_operation):
            await asyncio.Event().wait()
        return httpx.Response(200, json={"access_token": "unit-token", "expires_in": 7200})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(AppException) as failure:
            await WechatPhoneClient(miniapp_settings(), redis, http).exchange("unit-code", "subject")
        assert failure.value.code == error_code
        assert len(requests) == request_count
        assert redis.set.await_count == redis_set_count
        redis.eval.assert_awaited_once()
