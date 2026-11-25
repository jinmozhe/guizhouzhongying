import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import type { PointsAccountRead, PointsManualAdjustment } from "@pinjie/api-client";

import { commerceApi } from "@/lib/api/commerce";
import { errorMessage } from "@/lib/api/http";
import { formatPhoneForDisplay, normalizePhoneForLookup } from "@/lib/phone";
import { useLockedMutation } from "@/lib/useLockedMutation";

export type PointsAdjustTarget = {
  user_id: string;
  username?: string | null;
  display_name?: string | null;
  phone_e164?: string | null;
  phone_verified_at?: string | null;
  available_points?: number;
  frozen_points?: number;
  debt_points?: number;
};

export type PointsReversalContext = {
  ledgerId: string;
  maxPoints: number;
  sourceLabel: string;
};

type AdjustFormValues = {
  operation: "grant" | "reverse";
  points: number;
  reverses_ledger_id?: string;
  note: string;
};

type PointsAdjustModalProps = {
  open: boolean;
  initialTarget?: PointsAdjustTarget | null;
  lockTarget?: boolean;
  reversalContext?: PointsReversalContext | null;
  onClose: () => void;
  onSuccess?: (updatedAccount: PointsAccountRead) => void;
};

function hasBalance(target: PointsAdjustTarget | null): target is PointsAdjustTarget & {
  available_points: number;
  frozen_points: number;
  debt_points: number;
} {
  return (
    target !== null &&
    typeof target.available_points === "number" &&
    typeof target.frozen_points === "number" &&
    typeof target.debt_points === "number"
  );
}

/**
 * 跨页面复用的积分人工授予/冲销弹窗组件。
 * 支持通过手机号自动核验目标用户，也支持从积分管理或用户管理行内直接锁定目标用户。
 */
export function PointsAdjustModal({
  open,
  initialTarget = null,
  lockTarget = false,
  reversalContext = null,
  onClose,
  onSuccess,
}: PointsAdjustModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AdjustFormValues>();
  const currentOp = Form.useWatch("operation", form);
  const submitted = useRef<PointsManualAdjustment | null>(null);

  const [phoneInput, setPhoneInput] = useState("");
  const [resolvedTarget, setResolvedTarget] = useState<PointsAdjustTarget | null>(null);
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const lookupSeqRef = useRef(0);

  const effectiveLockTarget = lockTarget || Boolean(reversalContext);

  const runPhoneLookup = useCallback(async (rawPhone: string, showFormatError: boolean, preserveOnError = false) => {
    const normalized = normalizePhoneForLookup(rawPhone);
    if (!normalized) {
      if (!preserveOnError) setResolvedTarget(null);
      setLookupPending(false);
      setLookupError(showFormatError ? "请输入有效的 11 位中国大陆手机号或国际格式手机号" : null);
      return;
    }
    const seq = ++lookupSeqRef.current;
    setLookupPending(true);
    setLookupError(null);
    try {
      const target = await commerceApi.lookupPointsTarget(normalized);
      if (lookupSeqRef.current !== seq) return;
      setResolvedTarget({
        user_id: target.user_id,
        username: target.username,
        display_name: target.display_name ?? null,
        phone_e164: target.phone_e164,
        phone_verified_at: target.phone_verified_at,
        available_points: target.available_points,
        frozen_points: target.frozen_points,
        debt_points: target.debt_points,
      });
    } catch (error) {
      if (lookupSeqRef.current !== seq) return;
      if (!preserveOnError) setResolvedTarget(null);
      setLookupError(errorMessage(error));
    } finally {
      if (lookupSeqRef.current === seq) {
        setLookupPending(false);
      }
    }
  }, []);

  const adjustMutation = useLockedMutation({
    mutationFn: (values: AdjustFormValues) => {
      if (!submitted.current) {
        if (!resolvedTarget) {
          return Promise.reject(new Error("请先输入有效手机号并确认目标用户"));
        }
        submitted.current = {
          user_id: resolvedTarget.user_id,
          operation: values.operation,
          points: values.points,
          reverses_ledger_id:
            values.operation === "reverse"
              ? (reversalContext?.ledgerId ?? values.reverses_ledger_id?.trim()) || null
              : null,
          note: values.note.trim(),
          idempotency_key: globalThis.crypto.randomUUID(),
        };
      }
      return commerceApi.adjustPoints(submitted.current);
    },
    onSuccess: (updatedAccount) => {
      message.success("积分人工调整成功");
      lookupSeqRef.current += 1;
      submitted.current = null;
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["admin-points-accounts"] });
      onSuccess?.(updatedAccount);
      onClose();
    },
    onError: (error: unknown) => {
      message.error(errorMessage(error));
    },
  });

  const resetMutationRef = useRef(adjustMutation.reset);
  resetMutationRef.current = adjustMutation.reset;

  // 每次打开弹窗时同步初始化表单与目标用户；若缺少余额且已绑定手机号则自动拉取最新余额。
  useEffect(() => {
    if (!open) return;
    lookupSeqRef.current += 1;
    submitted.current = null;
    resetMutationRef.current();
    form.resetFields();
    if (reversalContext) {
      form.setFieldsValue({
        operation: "reverse",
        points: reversalContext.maxPoints > 0 ? reversalContext.maxPoints : 1,
        reverses_ledger_id: reversalContext.ledgerId,
        note: "",
      });
    } else {
      form.setFieldsValue({
        operation: "grant",
        points: 100,
        note: "",
      });
    }
    setLookupPending(false);
    setLookupError(null);
    if (initialTarget) {
      setPhoneInput(formatPhoneForDisplay(initialTarget.phone_e164) ?? "");
      setResolvedTarget(initialTarget);
      if (!hasBalance(initialTarget) && initialTarget.phone_e164) {
        void runPhoneLookup(initialTarget.phone_e164, false, true);
      }
    } else {
      setPhoneInput("");
      setResolvedTarget(null);
    }
  }, [open, initialTarget, reversalContext, form, runPhoneLookup]);

  // 非锁定模式下，输入完整手机号后自动防抖查询目标用户。
  useEffect(() => {
    if (!open || effectiveLockTarget || Boolean(submitted.current)) return;
    const normalized = normalizePhoneForLookup(phoneInput);
    if (!normalized) return;
    if (resolvedTarget?.phone_e164 === normalized) return;
    const timer = window.setTimeout(() => {
      void runPhoneLookup(phoneInput, false);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, effectiveLockTarget, phoneInput, resolvedTarget?.phone_e164, runPhoneLookup]);

  const handlePhoneInputChange = (nextValue: string) => {
    lookupSeqRef.current += 1;
    setPhoneInput(nextValue);
    setResolvedTarget(null);
    setLookupPending(false);
    setLookupError(null);
  };

  const handleCancel = () => {
    if (adjustMutation.isPending) return;
    lookupSeqRef.current += 1;
    submitted.current = null;
    setLookupPending(false);
    setLookupError(null);
    form.resetFields();
    adjustMutation.reset();
    onClose();
  };

  const canSubmit = Boolean(submitted.current) || (Boolean(resolvedTarget) && !lookupPending);

  const targetDescription = (() => {
    if (!resolvedTarget) return undefined;
    if (hasBalance(resolvedTarget)) {
      return `当前积分：可用 ${resolvedTarget.available_points} / 冻结 ${resolvedTarget.frozen_points} / 欠积分 ${resolvedTarget.debt_points}`;
    }
    if (lookupPending) {
      return "正在加载该用户当前积分余额…";
    }
    if (!resolvedTarget.phone_e164) {
      return "该用户尚未绑定手机号，将直接按选定账户执行积分调整。";
    }
    return "未能获取实时积分余额，仍可按选定账户执行调整。";
  })();

  return (
    <Modal
      title={reversalContext ? "冲销授予积分" : "人工授予或冲销积分"}
      open={open}
      mask={{ closable: false }}
      closable={!adjustMutation.isPending}
      keyboard={!adjustMutation.isPending}
      cancelButtonProps={{ disabled: adjustMutation.isPending }}
      okButtonProps={{ disabled: !canSubmit || adjustMutation.isPending }}
      onCancel={handleCancel}
      onOk={() => {
        if (submitted.current) {
          adjustMutation.mutate(form.getFieldsValue());
        } else {
          form.submit();
        }
      }}
      confirmLoading={adjustMutation.isPending}
    >
      {adjustMutation.error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          title={errorMessage(adjustMutation.error)}
          description="重试将沿用同一请求及幂等键。取消前请核对积分流水，避免重复发起调整。"
        />
      )}

      <Form<AdjustFormValues>
        form={form}
        layout="vertical"
        disabled={adjustMutation.isPending || Boolean(submitted.current)}
        onFinish={(values) => adjustMutation.mutate(values)}
      >
        <Form.Item
          label="目标用户手机号"
          extra={
            effectiveLockTarget
              ? "当前操作已锁定目标用户，如需更改请关闭弹窗重新选择。"
              : "输入 11 位手机号将自动查询注册用户，确认存在后才允许提交。"
          }
        >
          <Space.Compact style={{ width: "100%" }}>
            <Input
              inputMode="tel"
              maxLength={16}
              placeholder={effectiveLockTarget && !phoneInput ? "未绑定手机号" : "请输入 11 位手机号"}
              value={phoneInput}
              disabled={effectiveLockTarget || adjustMutation.isPending || Boolean(submitted.current)}
              onChange={(event) => handlePhoneInputChange(event.target.value)}
              onPressEnter={(event) => {
                event.preventDefault();
                if (!effectiveLockTarget) void runPhoneLookup(phoneInput, true);
              }}
            />
            {!effectiveLockTarget && (
              <Button
                icon={<SearchOutlined />}
                loading={lookupPending}
                disabled={adjustMutation.isPending || Boolean(submitted.current)}
                onClick={() => void runPhoneLookup(phoneInput, true)}
              >
                查询
              </Button>
            )}
          </Space.Compact>
        </Form.Item>

        {lookupError && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title={lookupError}
            description={
              effectiveLockTarget
                ? "未能通过手机号拉取实时余额，请确认该用户状态是否正常。"
                : "未找到有效用户时无法操作积分，请核对手机号是否正确且已在小程序完成绑定。"
            }
          />
        )}

        {resolvedTarget && (
          <Alert
            type={resolvedTarget.phone_e164 ? "success" : "info"}
            showIcon
            style={{ marginBottom: 16 }}
            title={`已锁定用户：${resolvedTarget.display_name || resolvedTarget.username || resolvedTarget.user_id}${
              formatPhoneForDisplay(resolvedTarget.phone_e164)
                ? `（${formatPhoneForDisplay(resolvedTarget.phone_e164)}）`
                : "（未绑定手机号）"
            }`}
            description={targetDescription}
          />
        )}

        <Form.Item name="operation" label="操作类型" rules={[{ required: true }]}>
          <Select
            disabled={Boolean(reversalContext)}
            options={[
              { value: "grant", label: "人工授予积分（增加可用积分，计入升级资格）" },
              { value: "reverse", label: "冲销原授予积分（回退原授予流水）" },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="points"
          label="积分点数"
          extra={
            reversalContext
              ? `来源：${reversalContext.sourceLabel}，本笔流水最多可冲销 ${reversalContext.maxPoints} 积分`
              : undefined
          }
          rules={[
            { required: true, message: "请输入积分数量" },
            ...(reversalContext
              ? [
                  {
                    type: "number" as const,
                    max: reversalContext.maxPoints,
                    message: `冲销积分不能超过剩余可冲销额度 ${reversalContext.maxPoints}`,
                  },
                ]
              : []),
          ]}
        >
          <InputNumber
            min={1}
            max={reversalContext?.maxPoints}
            step={1}
            precision={0}
            style={{ width: "100%" }}
            placeholder="输入整数积分数量"
          />
        </Form.Item>

        {currentOp === "reverse" && (
          <Form.Item
            name="reverses_ledger_id"
            label="被冲销的原积分流水 ID"
            extra={
              reversalContext
                ? "已从积分流水抽屉自动带入原流水标识。"
                : "建议在“积分管理”打开该用户的“积分流水”抽屉，直接点击对应授予流水的“冲销”按钮自动带入。"
            }
            rules={[{ required: true, message: "冲销操作必须提供原流水 ID" }]}
          >
            <Input
              readOnly={Boolean(reversalContext)}
              placeholder="输入原授予流水的 UUID，或从积分流水抽屉快捷冲销"
            />
          </Form.Item>
        )}

        <Form.Item
          name="note"
          label="操作原因及核对说明"
          rules={[
            { required: true, whitespace: true, message: "请输入操作说明以便审计" },
            { max: 200, message: "操作说明不能超过 200 个字符" },
          ]}
        >
          <Input maxLength={200} showCount placeholder="详细记录授予或冲销原因，用于合规审计" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
