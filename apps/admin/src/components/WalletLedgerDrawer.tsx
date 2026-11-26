import { useEffect, useState } from "react";
import { Alert, Descriptions, Drawer, Flex, Segmented, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";
import type { WalletLedgerRead } from "@pinjie/api-client";

import { QueryState, formatTime } from "@/components/PageFrame";
import { canAccess, useCurrentAdmin } from "@/lib/auth-context";
import { commerceApi } from "@/lib/api/commerce";
import { errorMessage } from "@/lib/api/http";
import { formatPhoneForDisplay } from "@/lib/phone";

export type WalletTrackType = "commission" | "consumption";

export type WalletLedgerUser = {
  user_id: string;
  username?: string | null;
  display_name?: string | null;
  phone_e164?: string | null;
};

type WalletLedgerDrawerProps = {
  open: boolean;
  user: WalletLedgerUser | null;
  initialWalletType?: WalletTrackType;
  zIndex?: number;
  onClose: () => void;
};

const ENTRY_TYPE_META: Record<string, { label: string; color: string }> = {
  commission_settlement: { label: "佣金结算入账", color: "green" },
  commission_recovery: { label: "退款佣金追回", color: "volcano" },
  withdrawal_freeze: { label: "提现申请冻结", color: "gold" },
  withdrawal_release: { label: "提现拒绝解冻", color: "cyan" },
  withdrawal_paid: { label: "提现打款扣减", color: "blue" },
};

const REFERENCE_TYPE_LABEL: Record<string, string> = {
  commission: "佣金记录",
  commission_recovery: "佣金追回",
  withdrawal: "提现申请",
  order: "交易订单",
  refund: "退款申请",
};

function isPositiveAmount(value?: string | null): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isNegativeAmount(value?: string | null): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed < 0;
}

function formatSignedCurrency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "0.00";
  return parsed > 0 ? `+¥${value}` : `-¥${value.replace(/^-/, "")}`;
}

function userDisplayName(user: Pick<WalletLedgerUser, "display_name" | "username" | "user_id">): string {
  return user.display_name || user.username || user.user_id;
}

/**
 * 跨页面复用的用户双轨钱包余额概览与不可变流水抽屉。
 * 支持在佣金钱包与消费钱包之间切换，供用户管理与钱包管理页共用。
 */
export function WalletLedgerDrawer({
  open,
  user,
  initialWalletType = "commission",
  zIndex = 1010,
  onClose,
}: WalletLedgerDrawerProps) {
  const admin = useCurrentAdmin();
  const canRead = canAccess(admin, "wallets:read");
  const [walletType, setWalletType] = useState<WalletTrackType>(initialWalletType);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (open) {
      setWalletType(initialWalletType);
      setPage(1);
    }
  }, [open, user?.user_id, initialWalletType]);

  const query = useQuery({
    queryKey: ["admin-user-wallet-ledgers", user?.user_id, walletType, page],
    queryFn: () => commerceApi.userWalletLedgers(user!.user_id, walletType, page),
    enabled: open && Boolean(user?.user_id) && canRead,
  });

  const activeWallet =
    walletType === "commission"
      ? (query.data?.commission_wallet ?? null)
      : (query.data?.consumption_wallet ?? null);

  const columns: ColumnsType<WalletLedgerRead> = [
    {
      title: "变动类型",
      dataIndex: "entry_type",
      key: "entry_type",
      render: (value: string) => {
        const meta = ENTRY_TYPE_META[value] ?? { label: value, color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "可用变动",
      dataIndex: "amount",
      key: "amount",
      render: (value: string) => {
        if (isPositiveAmount(value)) return <Typography.Text type="success">{formatSignedCurrency(value)}</Typography.Text>;
        if (isNegativeAmount(value)) return <Typography.Text type="danger">{formatSignedCurrency(value)}</Typography.Text>;
        return <span>0.00</span>;
      },
    },
    {
      title: "冻结变动",
      dataIndex: "frozen_delta",
      key: "frozen_delta",
      render: (value: string) => {
        if (!isPositiveAmount(value) && !isNegativeAmount(value)) return "-";
        return <Typography.Text type="warning">{formatSignedCurrency(value)}</Typography.Text>;
      },
    },
    {
      title: "欠款变动",
      dataIndex: "debt_delta",
      key: "debt_delta",
      render: (value: string) => {
        if (!isPositiveAmount(value) && !isNegativeAmount(value)) return "-";
        return <Typography.Text type="danger">{formatSignedCurrency(value)}</Typography.Text>;
      },
    },
    {
      title: "关联业务",
      key: "reference",
      render: (_, row) => (
        <Flex align="center" gap={6}>
          <Tag style={{ marginInlineEnd: 0 }}>{REFERENCE_TYPE_LABEL[row.reference_type] ?? row.reference_type}</Tag>
          <Typography.Text copyable={{ text: row.reference_id }} type="secondary">
            {row.reference_id.slice(0, 8)}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: "账本版本",
      dataIndex: "wallet_revision",
      key: "wallet_revision",
      width: 90,
      render: (v: number) => `v${v}`,
    },
    {
      title: "入账时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (v: string) => formatTime(v),
    },
  ];

  const drawerTitle = user
    ? `钱包不可变流水 - ${userDisplayName(user)}${
        formatPhoneForDisplay(user.phone_e164) ? `（${formatPhoneForDisplay(user.phone_e164)}）` : ""
      }`
    : "钱包不可变流水";

  const walletTrackLabel = walletType === "commission" ? "佣金钱包" : "消费钱包";

  return (
    <Drawer
      title={<Typography.Text strong>{drawerTitle}</Typography.Text>}
      open={open}
      onClose={onClose}
      size={960}
      zIndex={zIndex}
      extra={
        <Segmented<WalletTrackType>
          aria-label="切换钱包轨道"
          value={walletType}
          options={[
            { label: "佣金钱包", value: "commission" },
            { label: "消费钱包", value: "consumption" },
          ]}
          onChange={(next) => {
            setWalletType(next);
            setPage(1);
          }}
        />
      }
    >
      {!canRead ? (
        <Alert
          type="warning"
          showIcon
          title="当前账号缺少钱包查看权限（wallets:read）"
          description="无法查看该用户的双轨钱包余额与不可变流水。"
        />
      ) : (
        <>
          <QueryState
            loading={false}
            error={query.isError ? errorMessage(query.error) : undefined}
            onRetry={() => void query.refetch()}
          />

          {!query.isError && (
            <>
              <Descriptions
                size="small"
                bordered
                column={{ xs: 1, sm: 3 }}
                style={{ marginBottom: 16 }}
                items={[
                  {
                    key: "available",
                    label: `${walletTrackLabel}可用余额`,
                    children: query.data ? (
                      <Typography.Text strong style={{ color: "#389e0d" }}>
                        ¥{activeWallet ? activeWallet.available_amount : "0.00"}
                      </Typography.Text>
                    ) : (
                      "-"
                    ),
                  },
                  {
                    key: "frozen",
                    label: "提现/业务冻结",
                    children: query.data ? (
                      <Typography.Text type={isPositiveAmount(activeWallet?.frozen_amount) ? "warning" : "secondary"}>
                        ¥{activeWallet ? activeWallet.frozen_amount : "0.00"}
                      </Typography.Text>
                    ) : (
                      "-"
                    ),
                  },
                  {
                    key: "debt",
                    label: "退款追佣欠款",
                    children: query.data ? (
                      <Typography.Text type={isPositiveAmount(activeWallet?.debt_amount) ? "danger" : "secondary"}>
                        ¥{activeWallet ? activeWallet.debt_amount : "0.00"}
                      </Typography.Text>
                    ) : (
                      "-"
                    ),
                  },
                ]}
              />

              {!query.isLoading && query.data && !activeWallet && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  title={`该用户尚未初始化${walletTrackLabel}账户`}
                  description="双轨钱包不支持后台手工改写余额；用户登录或业务入账时将自动按规则建账。"
                />
              )}

              <Table<WalletLedgerRead>
                rowKey="id"
                loading={query.isLoading || query.isFetching}
                dataSource={query.data?.ledgers.items ?? []}
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
                  total: query.data?.ledgers.total ?? 0,
                  onChange: (nextPage) => setPage(nextPage),
                  showTotal: (total) => `共 ${total} 条钱包流水`,
                }}
              />
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
