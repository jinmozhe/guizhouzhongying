import { useState } from "react";
import { Alert, Button, Input, Space, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminPointsAccountRead } from "@pinjie/api-client";

import { PageFrame, QueryState, formatTime } from "@/components/PageFrame";
import {
  PointsAdjustModal,
  type PointsAdjustTarget,
} from "@/components/PointsAdjustModal";
import { PointsLedgerDrawer, type PointsLedgerUser } from "@/components/PointsLedgerDrawer";
import { canAccess, useCurrentAdmin } from "@/lib/auth-context";
import { commerceApi } from "@/lib/api/commerce";
import { errorMessage } from "@/lib/api/http";
import { formatPhoneForDisplay } from "@/lib/phone";

function accountDisplayName(row: Pick<AdminPointsAccountRead, "display_name" | "username" | "user_id">): string {
  return row.display_name || row.username || row.user_id;
}

export default function PointsPage() {
  const admin = useCurrentAdmin();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [phoneFilterDraft, setPhoneFilterDraft] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");

  const canRead = canAccess(admin, "points:read");
  const canAdjust = canAccess(admin, "points:adjust");

  const [ledgerUser, setLedgerUser] = useState<PointsLedgerUser | null>(null);
  const [adjustModalState, setAdjustModalState] = useState<{
    open: boolean;
    target: PointsAdjustTarget | null;
    lockTarget: boolean;
  }>({ open: false, target: null, lockTarget: false });

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

  const toLedgerUser = (row: AdminPointsAccountRead): PointsLedgerUser => ({
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
            onClick={() => setLedgerUser(toLedgerUser(row))}
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

      {/* 公共积分流水抽屉 */}
      <PointsLedgerDrawer
        open={Boolean(ledgerUser)}
        user={ledgerUser}
        onClose={() => setLedgerUser(null)}
      />

      {/* 公共积分人工授予/冲销弹窗 */}
      <PointsAdjustModal
        open={adjustModalState.open}
        initialTarget={adjustModalState.target}
        lockTarget={adjustModalState.lockTarget}
        onClose={() => setAdjustModalState({ open: false, target: null, lockTarget: false })}
        onSuccess={(updatedAccount) => {
          void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
          void queryClient.invalidateQueries({ queryKey: ["admin-user-points-ledgers", updatedAccount.user_id] });
        }}
      />
    </PageFrame>
  );
}
