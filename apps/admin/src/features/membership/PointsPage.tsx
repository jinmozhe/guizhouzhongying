import { useState } from "react";
import { Alert, Button, Drawer, Input, Space, Table, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined, RollbackOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";
import type { AdminPointsAccountRead, AdminPointsLedgerRead } from "@pinjie/api-client";

import { PageFrame, QueryState, formatTime } from "@/components/PageFrame";
import {
  PointsAdjustModal,
  type PointsAdjustTarget,
  type PointsReversalContext,
} from "@/components/PointsAdjustModal";
import { canAccess, useCurrentAdmin } from "@/lib/auth-context";
import { commerceApi } from "@/lib/api/commerce";
import { errorMessage } from "@/lib/api/http";
import { formatPhoneForDisplay } from "@/lib/phone";

const ENTRY_TYPE_META: Record<string, { label: string; color: string }> = {
  grant: { label: "授予", color: "green" },
  reverse: { label: "冲销", color: "volcano" },
  freeze: { label: "冻结", color: "gold" },
  spend: { label: "消费扣除", color: "blue" },
  release: { label: "退回释放", color: "cyan" },
  expire: { label: "过期失效", color: "default" },
};

function accountDisplayName(row: Pick<AdminPointsAccountRead, "display_name" | "username" | "user_id">): string {
  return row.display_name || row.username || row.user_id;
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

export default function PointsPage() {
  const admin = useCurrentAdmin();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [phoneFilterDraft, setPhoneFilterDraft] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");
  const [ledgerPage, setLedgerPage] = useState(1);

  const canRead = canAccess(admin, "points:read");
  const canAdjust = canAccess(admin, "points:adjust");

  const [selectedAccount, setSelectedAccount] = useState<AdminPointsAccountRead | null>(null);
  const [adjustModalState, setAdjustModalState] = useState<{
    open: boolean;
    target: PointsAdjustTarget | null;
    lockTarget: boolean;
    reversal: PointsReversalContext | null;
  }>({ open: false, target: null, lockTarget: false, reversal: null });

  const {
    data: accountsData,
    isLoading,
    isFetching,
    error: accountsError,
    refetch: reloadAccounts,
  } = useQuery({
    queryKey: ["admin-points-accounts", page, phoneFilter],
    queryFn: () => commerceApi.pointsAccounts(page, 20, phoneFilter || undefined),
    enabled: canRead,
  });

  const {
    data: ledgersData,
    isLoading: ledgersLoading,
    error: ledgersError,
    refetch: reloadLedgers,
  } = useQuery({
    queryKey: ["admin-points-ledgers", selectedAccount?.id, ledgerPage],
    queryFn: () => commerceApi.pointsLedgers(selectedAccount!.id, ledgerPage),
    enabled: Boolean(selectedAccount) && canRead,
  });

  const toTarget = (row: AdminPointsAccountRead): PointsAdjustTarget => ({
    user_id: row.user_id,
    username: row.username ?? null,
    display_name: row.display_name ?? null,
    phone_e164: row.phone_e164 ?? null,
    phone_verified_at: row.phone_verified_at ?? null,
    available_points: row.available_points,
    frozen_points: row.frozen_points,
    debt_points: row.debt_points,
  });

  const columns: ProColumns<AdminPointsAccountRead>[] = [
    {
      title: "用户",
      dataIndex: "username",
      render: (_, row) => (
        <div className="table-primary-cell">
          <Typography.Text strong>{accountDisplayName(row)}</Typography.Text>
          {row.username && <Typography.Text type="secondary">{row.username}</Typography.Text>}
        </div>
      ),
    },
    {
      title: "手机号",
      dataIndex: "phone_e164",
      width: 150,
      render: (_, row) => {
        const phone = formatPhoneForDisplay(row.phone_e164);
        if (!phone) return <Tag>未绑定</Tag>;
        const content = <Typography.Text copyable>{phone}</Typography.Text>;
        return row.phone_verified_at ? (
          <Tooltip title={`验证时间：${formatTime(row.phone_verified_at)}`}>{content}</Tooltip>
        ) : content;
      },
    },
    {
      title: "可用积分",
      dataIndex: "available_points",
      render: (_, row) => (
        <Typography.Text strong style={{ color: "#389e0d" }}>
          {row.available_points}
        </Typography.Text>
      ),
    },
    {
      title: "冻结积分",
      dataIndex: "frozen_points",
      render: (_, row) => (
        <Typography.Text type={row.frozen_points > 0 ? "warning" : "secondary"}>
          {row.frozen_points}
        </Typography.Text>
      ),
    },
    {
      title: "欠积分",
      dataIndex: "debt_points",
      render: (_, row) => (
        <Typography.Text type={row.debt_points > 0 ? "danger" : "secondary"}>
          {row.debt_points}
        </Typography.Text>
      ),
    },
    { title: "版本", dataIndex: "revision", width: 80 },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 170,
      render: (_, row) => formatTime(row.updated_at),
    },
    {
      title: "操作",
      key: "actions",
      width: "1%",
      render: (_, row) => (
        <Space size="small" wrap={false}>
          <Button
            size="small"
            icon={<UnorderedListOutlined />}
            onClick={() => {
              setSelectedAccount(row);
              setLedgerPage(1);
            }}
          >
            积分流水
          </Button>
          {canAdjust && (
            <Button
              size="small"
              onClick={() => {
                setAdjustModalState({
                  open: true,
                  target: toTarget(row),
                  lockTarget: !row.phone_e164,
                  reversal: null,
                });
              }}
            >
              人工调整
            </Button>
          )}
        </Space>
      ),
    },
  ];

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
              if (r.entry_type !== "grant" || (r.reversible_points ?? 0) <= 0 || !selectedAccount) {
                return "-";
              }
              return (
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<RollbackOutlined />}
                  onClick={() => {
                    setAdjustModalState({
                      open: true,
                      target: toTarget(selectedAccount),
                      lockTarget: true,
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
            },
          },
        ]
      : []),
  ];

  const selectedDrawerTitle = selectedAccount
    ? `积分不可变流水 - ${accountDisplayName(selectedAccount)}${
        formatPhoneForDisplay(selectedAccount.phone_e164)
          ? `（${formatPhoneForDisplay(selectedAccount.phone_e164)}）`
          : ""
      }`
    : "积分不可变流水";

  return (
    <PageFrame
      title="积分管理"
      description="查看商城用户积分账户资产（可用、冻结、欠积分），审计不可变积分流水并按手机号执行受控的人工授予与冲销操作。"
    >
      {!canRead ? (
        <Alert type="warning" title="无权查看积分账户列表" />
      ) : (
        <>
          <QueryState
            loading={isLoading}
            error={accountsError ? errorMessage(accountsError) : undefined}
            onRetry={() => void reloadAccounts()}
          />
          {!isLoading && !accountsError && (
            <ProTable<AdminPointsAccountRead>
              className="responsive-data-table"
              rowKey="id"
              headerTitle="积分账户列表"
              dataSource={accountsData?.items ?? []}
              loading={isFetching}
              search={false}
              cardProps={false}
              options={{
                density: true,
                fullScreen: true,
                reload: () => void reloadAccounts(),
                setting: true,
              }}
              toolBarRender={() => [
                <div className="responsive-table-toolbar" key="points-toolbar">
                  {canAdjust && (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() =>
                        setAdjustModalState({
                          open: true,
                          target: null,
                          lockTarget: false,
                          reversal: null,
                        })
                      }
                    >
                      人工授予 / 冲销积分
                    </Button>
                  )}
                  <Input.Search
                    allowClear
                    aria-label="按手机号搜索积分账户"
                    placeholder="输入手机号或尾号"
                    style={{ width: 220 }}
                    value={phoneFilterDraft}
                    onChange={(event) => setPhoneFilterDraft(event.target.value)}
                    onSearch={(value) => {
                      setPage(1);
                      setPhoneFilter(value.trim());
                    }}
                  />
                  <Button
                    onClick={() => {
                      setPage(1);
                      setPhoneFilterDraft("");
                      setPhoneFilter("");
                    }}
                  >
                    重置
                  </Button>
                </div>,
              ]}
              columns={columns.map((col) => ({
                ...col,
                onHeaderCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
                onCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
              }))}
              scroll={{ x: "max-content" }}
              pagination={{
                current: page,
                pageSize: 20,
                showSizeChanger: false,
                total: accountsData?.total ?? 0,
                onChange: (p) => setPage(p),
                showTotal: (total) => `共 ${total} 个积分账户`,
              }}
            />
          )}
        </>
      )}

      {/* 积分流水抽屉 */}
      <Drawer
        title={<Typography.Text strong>{selectedDrawerTitle}</Typography.Text>}
        open={Boolean(selectedAccount)}
        onClose={() => setSelectedAccount(null)}
        size={960}
      >
        <QueryState
          loading={false}
          error={ledgersError ? errorMessage(ledgersError) : undefined}
          onRetry={() => void reloadLedgers()}
        />
        {!ledgersError && (
          <Table<AdminPointsLedgerRead>
            rowKey="id"
            loading={ledgersLoading}
            dataSource={ledgersData?.items ?? []}
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
              total: ledgersData?.total ?? 0,
              onChange: (p) => setLedgerPage(p),
              showTotal: (total) => `共 ${total} 条积分流水`,
            }}
          />
        )}
      </Drawer>

      {/* 公共积分人工授予/冲销弹窗 */}
      <PointsAdjustModal
        open={adjustModalState.open}
        initialTarget={adjustModalState.target}
        lockTarget={adjustModalState.lockTarget}
        reversalContext={adjustModalState.reversal}
        onClose={() => setAdjustModalState({ open: false, target: null, lockTarget: false, reversal: null })}
        onSuccess={(updatedAccount) => {
          if (selectedAccount) {
            if (selectedAccount.id === updatedAccount.id) {
              setSelectedAccount((prev) =>
                prev
                  ? {
                      ...prev,
                      available_points: updatedAccount.available_points,
                      frozen_points: updatedAccount.frozen_points,
                      debt_points: updatedAccount.debt_points,
                      revision: updatedAccount.revision,
                      updated_at: updatedAccount.updated_at,
                    }
                  : prev,
              );
            }
            void queryClient.invalidateQueries({ queryKey: ["admin-points-ledgers", selectedAccount.id] });
          }
        }}
      />
    </PageFrame>
  );
}
