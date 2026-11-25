/**
 * 管理端手机号展示格式化工具。
 */

/**
 * 格式化 E.164 手机号用于管理端界面展示。
 * 中国大陆号码去掉 `+86` 前缀，其他国际格式保留原样，空值返回 `null`。
 */
export function formatPhoneForDisplay(phoneE164: string | null | undefined): string | null {
  if (!phoneE164) return null;
  const trimmed = phoneE164.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^\+86/, "");
}

/**
 * 将用户输入的手机号规范化为可查询的 E.164 格式。
 * 支持 11 位中国大陆手机号（自动补 `+86`）或合法国际 E.164 号码，格式未完整时返回 `null`。
 */
export function normalizePhoneForLookup(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^1[0-9]{10}$/.test(trimmed)) return `+86${trimmed}`;
  if (/^\+[1-9][0-9]{6,14}$/.test(trimmed)) return trimmed;
  return null;
}
