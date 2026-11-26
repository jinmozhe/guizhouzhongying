import { useEffect, useState } from "react";
import { Alert, Button, Descriptions, Drawer, Space, Table, Tag, Tooltip, Typography } from "antd";
import { GiftOutlined, RollbackOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";
import type { AdminPointsLedgerRead, PointsAccountRead } from "@pinjie/api-client";

import { QueryState, formatTime } from "@/components/PageFrame";
import {
  PointsAdjustModal,
  type PointsAdjustTarget,
  type PointsReversalContext,
} from "@/components/PointsAdjustModal";
import { canAccess, useCurrentAdmin } from "@/lib/auth-context";
import { commerceApi } from "@/lib/api/commerce";
import { errorMessage } from "@/lib/api/http";
import { formatPhoneForDisplay } from "@/lib/phone";

export type PointsLedgerUser = {
  user_id: string;
  username?: string | null;
  display_name?: string | null;
  phone_e164?: string | null;
  phone_verified_at?: string | null;
  is_active?: boolean;
  deleted_at?: string | null;
  available_points?: number;
  frozen_points?: number;
  debt_points?: number;
};

type PointsLedgerDrawerProps = {
  open: boolean;
  user: PointsLedgerUser | null;
  zIndex?: number;
  onClose: () => void;
  onAdjusted?: (updatedAccount: PointsAccountRead) => void;
};

const ENTRY_TYPE_META: Record<string, { label: string; color: string }> = {
  grant: { label: "授予", color: "green" },
  reverse: { label: "冲销", color: "volcano" },
  freeze: { label: "冻结", color: "gold" },
  spend: { label: "消费扣除", color: "blue" },
  release: { label: "退回释放", color: "cyan" },
  expire: { label: "过期失效", color: "default" },
};

function userDisplayName(user: Pick<PointsLedgerUser, "display_name" | "username" | "user_id">): string {
  return user.display_name || user.username || user.user_id;
}

function ledgerSourceLabel(row: AdminPointsLedgerRead): string {
  if (row.source_type === "property") {
    return row.property_operator_name ? `物业发放（${row.property_operator_name}）` : "物业发放";
  }
  if (row.source_type === "manual") {
    const operator = row.operator_admin_display_name || row.operator_admin_username;
    return operator ? `平台后台（${operator}）` : "平台后台";
  }
  if (row.source_type === "order") return "订单";
  if (row.source_type === "refund") return "退款";
  if (row.source_type === "invite") return "邀请奖励";
  if (row.source_type === "redemption") return "核销";
  return row.source_type;
}

/**
 * 跨页面复用的用户积分余额概览与不可变流水抽屉。
 * 供用户管理与积分管理共用，内置调整积分与单笔授予流水快捷冲销入口。
 */
export function PointsLedgerDrawer({ open, user, zIndex = 1010, onClose, onAdjusted }: PointsLedgerDrawerProps) {
  const admin = useCurrentAdmin();
  const queryClient = useQueryClient();
  const [ledgerPage, setLedgerPage] = useState(1);
  const [adjustModalState, setAdjustModalState] = useState<{
    open: boolean;
    reversal: PointsReversalContext | null;
  }>({ open: false, reversal: null });

  const canRead = canAccess(admin, "points:read");
  const canAdjust = canAccess(admin, "points:adjust");

  useEffect(() => {
    if (open) {
      setLedgerPage(1);
      setAdjustModalState({ open: false, reversal: null });
    }
  }, [open, user?.user_id]);

  const {
    data: userLedgersData,
    isLoading: ledgersLoading,
    isFetching: ledgersFetching,
    error: ledgersError,
    refetch: reloadLedgers,
  } = useQuery({
    queryKey: ["admin-user-points-ledgers", user?.user_id, ledgerPage],
    queryFn: () => commerceApi.userPointsLedgers(user!.user_id, ledgerPage),
    enabled: open && Boolean(user?.user_id) && canRead,
  });

  const isDeleted = Boolean(user?.deleted_at);
  const isInactive = user?.is_active === false;
  const adjustDisabledReason = isDeleted
    ? "回收站用户无法调整积分"
    : isInactive
      ? "停用用户无法调整积分"
      : undefined;

  const account = userLedgersData?.account ?? null;
  const resolvedAvailable = account ? account.available_points : userLedgersData ? 0 : user?.available_points;
  const resolvedFrozen = account ? account.frozen_points : userLedgersData ? 0 : user?.frozen_points;
  const resolvedDebt = account ? account.debt_points : userLedgersData ? 0 : user?.debt_points;

  const adjustTarget: PointsAdjustTarget | null = user
    ? {
        user_id: user.user_id,
        username: user.username ?? null,
        display_name: user.display_name ?? null,
        phone_e164: user.phone_e164 ?? null,
        phone_verified_at: user.phone_verified_at ?? null,
        ...(typeof resolvedAvailable === "number" &&
        typeof resolvedFrozen === "number" &&
        typeof resolvedDebt === "number"
          ? {
              available_points: resolvedAvailable,
              frozen_points: resolvedFrozen,
              debt_points: resolvedDebt,
            }
          : {}),
      }
    : null;

  const ledgerColumns: ColumnsType<AdminPointsLedgerRead> = [
    {
      title: "条目类型",
      dataIndex: "entry_type",
      key: "entry_type",
      render: (t: string) => {
        const meta = ENTRY_TYPE_META[t] ?? { label: t, color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "可用变动",
      dataIndex: "available_delta",
      key: "available_delta",
      render: (v: number) => {
        if (v > 0) return <Typography.Text type="success">+{v}</Typography.Text>;
        if (v < 0) return <Typography.Text type="danger">{v}</Typography.Text>;
        return <span>0</span>;
      },
    },
    {
      title: "冻结变动",
      dataIndex: "frozen_delta",
      key: "frozen_delta",
      render: (v: number) => {
        if (v === 0) return "-";
        return <Typography.Text type="warning">{v > 0 ? `+${v}` : v}</Typography.Text>;
      },
    },
    {
      title: "欠额变动",
      dataIndex: "debt_delta",
      key: "debt_delta",
      render: (v: number) => {
        if (v === 0) return "-";
        return <Typography.Text type="danger">{v > 0 ? `+${v}` : v}</Typography.Text>;
      },
    },
    {
      title: "来源与操作人",
      key: "source",
      render: (_, r) => {
        if (r.source_type === "property") {
          const actorPhone = formatPhoneForDisplay(r.property_actor_phone_e164);
          const actorName = r.property_actor_display_name || actorPhone || "物业操作员";
          return (
            <Space size={6} wrap={false}>
              <Tag color="purple">物业发放</Tag>
              <span>{r.property_operator_name || "物业"}</span>
              <Typography.Text type="secondary">
                {actorName}
                {actorPhone && actorName !== actorPhone ? `（${actorPhone}）` : ""}
              </Typography.Text>
              {r.property_actor_user_id && (
                <Tooltip title={`物业管理员用户 ID：${r.property_actor_user_id}`}>
                  <Typography.Text copyable={{ text: r.property_actor_user_id }} type="secondary">
                    UID:{r.property_actor_user_id.slice(0, 8)}
                  </Typography.Text>
                </Tooltip>
              )}
            </Space>
          );
        }
        if (r.source_type === "manual") {
          const adminName = r.operator_admin_display_name || r.operator_admin_username || r.source_id.slice(0, 8);
          return (
            <Space size={6} wrap={false}>
              <Tag color="blue">平台后台</Tag>
              <span>{adminName}</span>
            </Space>
          );
        }
        return (
          <Space size={6} wrap={false}>
            <Tag>{ledgerSourceLabel(r)}</Tag>
            <Typography.Text copyable={{ text: r.source_id }} type="secondary">
              {r.source_id.slice(0, 8)}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: "冲销状态 / 原流水",
      key: "reversal_state",
      render: (_, r) => {
        if (r.entry_type === "grant") {
          const remaining = r.reversible_points ?? 0;
          if (remaining <= 0) return <Tag>已全部冲销</Tag>;
          return (
            <Typography.Text type="secondary">
              可冲销 {remaining}
              {(r.reversed_points ?? 0) > 0 ? `（已冲 ${r.reversed_points}）` : ""}
            </Typography.Text>
          );
        }
        if (r.reverses_ledger_id) {
          return (
            <Typography.Text copyable={{ text: r.reverses_ledger_id }} type="secondary">
              原流水 {r.reverses_ledger_id.slice(0, 8)}
            </Typography.Text>
          );
        }
        return "-";
      },
    },
    { title: "说明备注", dataIndex: "note", key: "note", ellipsis: true, render: (v) => v || "-" },
    {
      title: "发生时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (v: string) => formatTime(v),
    },
    ...(canAdjust
      ? [
          {
            title: "操作",
            key: "actions",
            width: "1%",
            render: (_: unknown, r: AdminPointsLedgerRead) => {
              if (r.entry_type !== "grant" || (r.reversible_points ?? 0) <= 0 || !user) {
                return "-";
              }
              const button = (
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<RollbackOutlined />}
                  disabled={Boolean(adjustDisabledReason)}
                  onClick={() => {
                    setAdjustModalState({
                      open: true,
                      reversal: {
                        ledgerId: r.id,
                        maxPoints: r.reversible_points ?? 0,
                        sourceLabel: ledgerSourceLabel(r),
                      },
                    });
                  }}
                >
                  冲销
                </Button>
              );
              return adjustDisabledReason ? <Tooltip title={adjustDisabledReason}>{button}</Tooltip> : button;
            },
          },
        ]
      : []),
  ];

  const drawerTitle = user
    ? `积分不可变流水 - ${userDisplayName(user)}${
        formatPhoneForDisplay(user.phone_e164) ? `（${formatPhoneForDisplay(user.phone_e164)}）` : ""
      }`
    : "积分不可变流水";

  return (
    <>
      <Drawer
        title={<Typography.Text strong>{drawerTitle}</Typography.Text>}
        open={open}
        onClose={onClose}
        size={960}
        zIndex={zIndex}
        extra={
          canAdjust && user ? (
            <Tooltip title={adjustDisabledReason}>
              <Button
                type="primary"
                icon={<GiftOutlined />}
                disabled={Boolean(adjustDisabledReason)}
                onClick={() => setAdjustModalState({ open: true, reversal: null })}
              >
                调整积分
              </Button>
            </Tooltip>
          ) : null
        }
      >
        {!canRead ? (
          <Alert
            type="warning"
            showIcon
            title="当前账号缺少积分查看权限（points:read）"
            description="无法查看该用户的积分余额与不可变流水明细，可点击右上角“调整积分”执行受控的人工调整。"
          />
        ) : (
          <>
            <QueryState
              loading={false}
              error={ledgersError ? errorMessage(ledgersError) : undefined}
              onRetry={() => void reloadLedgers()}
            />

            {!ledgersError && (
              <>
                <Descriptions
                  size="small"
                  bordered
                  column={{ xs: 1, sm: 3 }}
                  style={{ marginBottom: 16 }}
                  items={[
                    {
                      key: "available",
                      label: "可用积分",
                      children:
                        typeof resolvedAvailable === "number" ? (
                          <Typography.Text strong style={{ color: "#389e0d" }}>
                            {resolvedAvailable}
                          </Typography.Text>
                        ) : (
                          "-"
                        ),
                    },
                    {
                      key: "frozen",
                      label: "冻结积分",
                      children:
                        typeof resolvedFrozen === "number" ? (
                          <Typography.Text type={resolvedFrozen > 0 ? "warning" : "secondary"}>
                            {resolvedFrozen}
                          </Typography.Text>
                        ) : (
                          "-"
                        ),
                    },
                    {
                      key: "debt",
                      label: "欠积分",
                      children:
                        typeof resolvedDebt === "number" ? (
                          <Typography.Text type={resolvedDebt > 0 ? "danger" : "secondary"}>
                            {resolvedDebt}
                          </Typography.Text>
                        ) : (
                          "-"
                        ),
                    },
                  ]}
                />

                {!ledgersLoading && userLedgersData && !userLedgersData.account && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    title="该用户尚未初始化积分账户（当前余额为 0）"
                    description="首次由后台人工授予积分或业务发分时将自动创建积分账户并记录流水。"
                  />
                )}

                <Table<AdminPointsLedgerRead>
                  rowKey="id"
                  loading={ledgersLoading || ledgersFetching}
                  dataSource={userLedgersData?.ledgers.items ?? []}
                  columns={ledgerColumns.map((col) => ({
                    ...col,
                    onHeaderCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
                    onCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
                  }))}
                  scroll={{ x: "max-content" }}
                  pagination={{
                    current: ledgerPage,
                    pageSize: 20,
                    showSizeChanger: false,
                    total: userLedgersData?.ledgers.total ?? 0,
                    onChange: (p) => setLedgerPage(p),
                    showTotal: (total) => `共 ${total} 条积分流水`,
                  }}
                />
              </>
            )}
          </>
        )}
      </Drawer>

      <PointsAdjustModal
        open={adjustModalState.open}
        initialTarget={adjustTarget}
        lockTarget
        reversalContext={adjustModalState.reversal}
        zIndex={zIndex + 10}
        onClose={() => setAdjustModalState({ open: false, reversal: null })}
        onSuccess={(updatedAccount) => {
          if (user) {
            void queryClient.invalidateQueries({ queryKey: ["admin-user-points-ledgers", user.user_id] });
          }
          void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
          void queryClient.invalidateQueries({ queryKey: ["admin-points-accounts"] });
          void queryClient.invalidateQueries({ queryKey: ["admin-points-ledgers"] });
          onAdjusted?.(updatedAccount);
        }}
      />
    </>
  );
}
