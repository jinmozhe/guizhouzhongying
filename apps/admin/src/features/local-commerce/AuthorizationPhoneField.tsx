import { Form, Input } from "antd";

export function displayAuthorizationPhone(phone: string) {
  return phone.replace(/^\+86/, "");
}

function normalizeAuthorizationPhone(phone: string) {
  const value = phone.trim();
  return /^1[0-9]{10}$/.test(value) ? `+86${value}` : value;
}

export function AuthorizationPhoneField({ label, extra }: { label: string; extra: string }) {
  return (
    <Form.Item
      name="phone_e164"
      label={label}
      extra={extra}
      getValueProps={(phone: string | undefined) => ({ value: displayAuthorizationPhone(phone ?? "") })}
      normalize={normalizeAuthorizationPhone}
      rules={[
        { required: true, message: `请输入${label}` },
        { pattern: /^\+[1-9][0-9]{6,14}$/, message: `请输入有效的${label}` },
      ]}
    >
      <Input inputMode="tel" maxLength={16} />
    </Form.Item>
  );
}
