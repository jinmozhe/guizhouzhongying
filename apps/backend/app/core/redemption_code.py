import base64
import hashlib
import io
import secrets

import qrcode
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings
from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException


def cipher() -> Fernet:
    key = get_settings().local_redemption_key
    if key is None:
        raise AppException(status_code=503, code=ErrorCode.SERVICE_UNAVAILABLE, message="到店核销凭证保护尚未配置")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeError) as exc:
        raise AppException(status_code=503, code=ErrorCode.SERVICE_UNAVAILABLE, message="到店核销凭证配置无效") from exc


def digest(code: str) -> str:
    return hashlib.sha256(code.encode("ascii")).hexdigest()


def generate_code() -> tuple[str, str]:
    code = secrets.token_urlsafe(24)
    return digest(code), cipher().encrypt(code.encode("ascii")).decode("ascii")


def decrypt_code(ciphertext: str) -> str:
    try:
        return cipher().decrypt(ciphertext.encode("ascii")).decode("ascii")
    except (InvalidToken, UnicodeError) as exc:
        raise AppException(
            status_code=503, code=ErrorCode.SERVICE_UNAVAILABLE, message="核销凭证解密失败，请联系平台恢复配置"
        ) from exc


def qr_data_url(code: str) -> str:
    image = qrcode.make(code)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")
