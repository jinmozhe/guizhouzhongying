import type { UserRecentOrderRead } from "@pinjie/api-client";
import {
  ApartmentOutlined,
  GiftOutlined,
  HistoryOutlined,
  HomeOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  WalletOutlined,
  WechatOutlined,
} from "@ant-design/icons";
import { history } from "@umijs/max";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Divider, Drawer, Flex, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { AdminAvatar } from "@/components/AdminAvatar";
import type { MemberHistoryUser } from "@/components/MemberHistoryDrawer";
import { QueryState, formatTime } from "@/components/PageFrame";
import type { PointsLedgerUser } from "@/components/PointsLedgerDrawer";
import type { WalletLedgerUser, WalletTrackType } from "@/components/WalletLedgerDrawer";
import { canAccess, useCurrentAdmin } from "@/features/auth";
import { adminApi } from "@/lib/api/admin";
import { errorMessage } from "@/lib/api/http";
import { formatPhoneForDisplay } from "@/lib/phone";
import { formatUserPrimaryName } from "@/lib/user-display";

type UserDetailDrawerProps = {
  open: boolean;
  userId: string | null;
  onClose: () => void;
  onSelectUser: (nextUserId: string) => void;
  onOpenPoints: (user: PointsLedgerUser) => void;
  onOpenWallet: (user: WalletLedgerUser, walletType: WalletTrackType) => void;
  onOpenMemberHistory: (user: MemberHistoryUser) => void;
  onEditMerchant: (merchantId: string) => void;
  onEditProperty: (operatorId: string) => void;
};

const ORDER_STATUS_META: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "待付款", color: "gold" },
  paid: { label: "已付款", color: "green" },
  cancelled: { label: "已取消", color: "default" },
};

function hasPositiveAmount(value?: string | null): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

/**
 * 用户综合详情抽屉：聚合基础档案、业务身份、三项资产速览、会员分销关系及消费订单概览。
 */
export function UserDetailDrawer({
  open,
  userId,
  onClose,
  onSelectUser,
  onOpenPoints,
  onOpenWallet,
  onOpenMemberHistory,
  onEditMerchant,
  onEditProperty,
}: UserDetailDrawerProps) {
  const current = useCurrentAdmin();
  const canReadPoints = canAccess(current, "points:read");
  const canAdjustPoints = canAccess(current, "points:adjust");
  const canReadWallets = canAccess(current, "wallets:read");
  const canReadMembers = canAccess(current, "members:read");
  const canReadOrders = canAccess(current, "orders:read");
  const canManageMerchant = canAccess(current, "merchants:read") && canAccess(current, "merchants:update");
  const canManageProperty =
    canAccess(current, "property-operators:read") && canAccess(current, "property-operators:update");

  const overviewQuery = useQuery({
    queryKey: ["admin-user-overview", userId],
    queryFn: () => adminApi.userOverview(userId!),
    enabled: open && Boolean(userId),
  });

  const data = overviewQuery.data;
  const user = data?.user;
  const isDeleted = Boolean(user?.deleted_at);

  const recentOrderColumns: ColumnsType<UserRecentOrderRead> = [
    {
      title: "订单号",
      dataIndex: "id",
      key: "id",
      render: (value: string) => (
        <Typography.Text copyable={{ text: value }} type="secondary">
          {value.slice(0, 8)}
        </Typography.Text>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (value: string) => {
        const meta = ORDER_STATUS_META[value] ?? { label: value, color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "方式",
      dataIndex: "fulfillment_mode",
      key: "fulfillment_mode",
      render: (value: string) => <Tag>{value === "local" ? "到店核销" : "历史履约"}</Tag>,
    },
    {
      title: "成交总额",
      dataIndex: "order_gross_amount",
      key: "order_gross_amount",
      render: (value: string) => <Typography.Text strong>¥{value}</Typography.Text>,
    },
    {
      title: "积分抵扣",
      dataIndex: "points_deduction",
      key: "points_deduction",
      render: (value: number) => (value > 0 ? `${value} 分` : "-"),
    },
    {
      title: "现金应付",
      dataIndex: "total_amount",
      key: "total_amount",
      render: (value: string) => `¥${value}`,
    },
    {
      title: "下单时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (value: string) => formatTime(value),
    },
  ];

  const baseTarget = user
    ? {
        user_id: user.id,
        username: user.username,
        display_name: user.display_name ?? null,
        phone_e164: user.phone_e164 ?? null,
      }
    : null;

  return (
    <Drawer
      title={
        <Typography.Text strong>
          {user ? `用户详情 - ${formatUserPrimaryName(user)}` : "用户详情"}
        </Typography.Text>
      }
      open={open}
      onClose={onClose}
      size={880}
      zIndex={990}
    >
      <QueryState
        loading={overviewQuery.isLoading}
        error={overviewQuery.isError ? errorMessage(overviewQuery.error) : undefined}
        onRetry={() => void overviewQuery.refetch()}
      />

      {data && user && baseTarget && (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {isDeleted && (
            <Alert
              type="warning"
              showIcon
              title="该用户当前位于回收站"
              description="仅支持只读审计历史资料、资产与流水，如需变更权限或操作积分请先恢复并启用账户。"
            />
          )}

          {/* 顶部身份头 */}
          <Flex align="center" justify="space-between" wrap gap={12}>
            <Flex align="center" gap={12}>
              <AdminAvatar
                size={48}
                admin={{
                  avatar: user.avatar ?? null,
                  display_name: user.display_name ?? null,
                  username: user.username,
                }}
              />
              <div>
                <Flex align="center" gap={8} wrap>
                  <Typography.Text strong style={{ fontSize: 16 }}>
                    {formatUserPrimaryName(user)}
                  </Typography.Text>
                  {isDeleted ? (
                    <Tag color="warning">回收站</Tag>
                  ) : user.is_active ? (
                    <Tag color="success">启用</Tag>
                  ) : (
                    <Tag color="default">停用</Tag>
                  )}
                  {data.has_wechat_identity && (
                    <Tag color="green" icon={<WechatOutlined />}>
                      已绑定微信
                    </Tag>
                  )}
                </Flex>
                <Typography.Text type="secondary">
                  用户名：
                  <Typography.Text copyable={{ text: user.username }} type="secondary">
                    {user.username}
                  </Typography.Text>
                  {" · UID："}
                  <Typography.Text copyable={{ text: user.id }} type="secondary">
                    {user.id}
                  </Typography.Text>
                </Typography.Text>
              </div>
            </Flex>
          </Flex>

          {/* 基础信息 */}
          <Descriptions
            size="small"
            bordered
            column={{ xs: 1, sm: 2 }}
            items={[
              {
                key: "phone",
                label: "手机号",
                children: (() => {
                  const phone = formatPhoneForDisplay(user.phone_e164);
                  if (!phone) return <Tag>未绑定</Tag>;
                  return (
                    <Space size={6}>
                      <Typography.Text copyable>{phone}</Typography.Text>
                      {user.phone_verified_at && (
                        <Typography.Text type="secondary">（验证于 {formatTime(user.phone_verified_at)}）</Typography.Text>
                      )}
                    </Space>
                  );
                })(),
              },
              {
                key: "roles",
                label: "业务身份",
                children: (() => {
                  const merchant = user.merchant_role;
                  const property = user.property_role;
                  if (!merchant && !property) return <Tag>普通会员</Tag>;
                  return (
                    <Space size={6} wrap>
                      {merchant && (
                        <Tooltip
                          title={`商家：${merchant.name}${merchant.is_active ? "（启用）" : "（停用）"}${
                            canManageMerchant && !isDeleted ? "，点击管理商家授权" : ""
                          }`}
                        >
                          {canManageMerchant && !isDeleted ? (
                            <Button
                              size="small"
                              type="link"
                              icon={<ShopOutlined />}
                              style={{ paddingInline: 0 }}
                              onClick={() => onEditMerchant(merchant.id)}
                            >
                              商家：{merchant.name}
                              {merchant.is_active ? "" : "（停用）"}
                            </Button>
                          ) : (
                            <Tag color={merchant.is_active ? "blue" : "default"}>
                              商家：{merchant.name}
                              {merchant.is_active ? "" : "（停用）"}
                            </Tag>
                          )}
                        </Tooltip>
                      )}
                      {property && (
                        <Tooltip
                          title={`物业：${property.name}${property.is_active ? "（启用）" : "（停用）"}${
                            canManageProperty && !isDeleted ? "，点击管理物业授权" : ""
                          }`}
                        >
                          {canManageProperty && !isDeleted ? (
                            <Button
                              size="small"
                              type="link"
                              icon={<HomeOutlined />}
                              style={{ paddingInline: 0 }}
                              onClick={() => onEditProperty(property.id)}
                            >
                              物业：{property.name}
                              {property.is_active ? "" : "（停用）"}
                            </Button>
                          ) : (
                            <Tag color={property.is_active ? "gold" : "default"}>
                              物业：{property.name}
                              {property.is_active ? "" : "（停用）"}
                            </Tag>
                          )}
                        </Tooltip>
                      )}
                    </Space>
                  );
                })(),
              },
              {
                key: "created_at",
                label: "注册时间",
                children: formatTime(user.created_at),
              },
              {
                key: "last_active_at",
                label: "最近活跃",
                children: data.last_active_at ? formatTime(data.last_active_at) : "暂无会话记录",
              },
            ]}
          />

          {/* 资产速览 */}
          {(canReadPoints || canAdjustPoints || canReadWallets) && (
            <>
              <Divider titlePlacement="left" style={{ margin: "4px 0" }}>
                资产速览
              </Divider>
              <Descriptions
                size="small"
                bordered
                column={{ xs: 1, sm: 3 }}
                items={[
                  ...(canReadPoints || canAdjustPoints
                    ? [
                        {
                          key: "points",
                          label: "积分账户",
                          children: (
                            <Flex justify="space-between" align="center" gap={8}>
                              <span>
                                {canReadPoints ? (
                                  <>
                                    <Typography.Text strong style={{ color: "#389e0d" }}>
                                      {user.points_summary?.available_points ?? 0}
                                    </Typography.Text>
                                    {(user.points_summary?.frozen_points ?? 0) > 0 && (
                                      <Typography.Text type="warning">
                                        {" "}
                                        / 冻 {user.points_summary?.frozen_points}
                                      </Typography.Text>
                                    )}
                                    {(user.points_summary?.debt_points ?? 0) > 0 && (
                                      <Typography.Text type="danger">
                                        {" "}
                                        / 欠 {user.points_summary?.debt_points}
                                      </Typography.Text>
                                    )}
                                  </>
                                ) : (
                                  <Typography.Text type="secondary">无查看权限</Typography.Text>
                                )}
                              </span>
                              <Button
                                type="link"
                                size="small"
                                icon={<GiftOutlined />}
                                style={{ paddingInline: 0 }}
                                onClick={() =>
                                  onOpenPoints({
                                    ...baseTarget,
                                    phone_verified_at: user.phone_verified_at ?? null,
                                    is_active: user.is_active,
                                    deleted_at: user.deleted_at ?? null,
                                    ...(user.points_summary
                                      ? {
                                          available_points: user.points_summary.available_points,
                                          frozen_points: user.points_summary.frozen_points,
                                          debt_points: user.points_summary.debt_points,
                                        }
                                      : {}),
                                  })
                                }
                              >
                                {canReadPoints ? "流水" : "调整"}
                              </Button>
                            </Flex>
                          ),
                        },
                      ]
                    : []),
                  ...(canReadWallets
                    ? [
                        {
                          key: "commission_wallet",
                          label: "佣金钱包",
                          children: (
                            <Flex justify="space-between" align="center" gap={8}>
                              <span>
                                <Typography.Text strong style={{ color: "#389e0d" }}>
                                  ¥{user.wallet_summary?.commission?.available_amount ?? "0.00"}
                                </Typography.Text>
                                {hasPositiveAmount(user.wallet_summary?.commission?.frozen_amount) && (
                                  <Typography.Text type="warning">
                                    {" "}
                                    / 冻 ¥{user.wallet_summary?.commission?.frozen_amount}
                                  </Typography.Text>
                                )}
                                {hasPositiveAmount(user.wallet_summary?.commission?.debt_amount) && (
                                  <Typography.Text type="danger">
                                    {" "}
                                    / 欠 ¥{user.wallet_summary?.commission?.debt_amount}
                                  </Typography.Text>
                                )}
                              </span>
                              <Button
                                type="link"
                                size="small"
                                icon={<WalletOutlined />}
                                style={{ paddingInline: 0 }}
                                onClick={() => onOpenWallet(baseTarget, "commission")}
                              >
                                流水
                              </Button>
                            </Flex>
                          ),
                        },
                        {
                          key: "consumption_wallet",
                          label: "消费钱包",
                          children: (
                            <Flex justify="space-between" align="center" gap={8}>
                              <span>
                                <Typography.Text strong>
                                  ¥{user.wallet_summary?.consumption?.available_amount ?? "0.00"}
                                </Typography.Text>
                                {hasPositiveAmount(user.wallet_summary?.consumption?.frozen_amount) && (
                                  <Typography.Text type="warning">
                                    {" "}
                                    / 冻 ¥{user.wallet_summary?.consumption?.frozen_amount}
                                  </Typography.Text>
                                )}
                              </span>
                              <Button
                                type="link"
                                size="small"
                                icon={<WalletOutlined />}
                                style={{ paddingInline: 0 }}
                                onClick={() => onOpenWallet(baseTarget, "consumption")}
                              >
                                流水
                              </Button>
                            </Flex>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </>
          )}

          {/* 会员与三级分销关系 */}
          {canReadMembers && data.membership && (
            <>
              <Flex justify="space-between" align="center" style={{ marginTop: 4 }}>
                <Typography.Text strong>会员与推荐关系</Typography.Text>
                <Space size={8}>
                  <Button
                    size="small"
                    icon={<HistoryOutlined />}
                    onClick={() => onOpenMemberHistory(baseTarget)}
                  >
                    等级与资格历史
                  </Button>
                  <Button
                    size="small"
                    icon={<ApartmentOutlined />}
                    onClick={() => {
                      onClose();
                      history.push(`/distribution/network?inviter_id=${user.id}`);
                    }}
                  >
                    查看下线团队
                  </Button>
                </Space>
              </Flex>

              <Descriptions
                size="small"
                bordered
                column={{ xs: 1, sm: 2 }}
                items={[
                  {
                    key: "level",
                    label: "当前会员等级",
                    children: user.member_level?.level_id ? (
                      <Tag color={user.member_level.level_is_active === false ? "default" : "gold"}>
                        {user.member_level.level_name || user.member_level.level_code || user.member_level.level_id.slice(0, 8)}
                        {user.member_level.level_is_active === false ? "（已停用）" : ""}
                      </Tag>
                    ) : (
                      <Tag>普通会员</Tag>
                    ),
                  },
                  {
                    key: "invitation_code",
                    label: "本人邀请码",
                    children: data.membership.invitation_code ? (
                      <Typography.Text copyable>{data.membership.invitation_code}</Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">未建会员档案</Typography.Text>
                    ),
                  },
                  {
                    key: "inviter",
                    label: "直属推荐人",
                    children: data.membership.inviter ? (
                      <Button
                        type="link"
                        size="small"
                        style={{ paddingInline: 0, height: "auto" }}
                        onClick={() => onSelectUser(data.membership!.inviter!.user_id)}
                      >
                        {data.membership.inviter.display_name || data.membership.inviter.username}
                        {formatPhoneForDisplay(data.membership.inviter.phone_e164)
                          ? `（${formatPhoneForDisplay(data.membership.inviter.phone_e164)}）`
                          : ""}
                      </Button>
                    ) : (
                      <Typography.Text type="secondary">无（首层用户）</Typography.Text>
                    ),
                  },
                  {
                    key: "team",
                    label: "下级团队规模",
                    children: (
                      <Space size={10}>
                        <span>
                          一级 <strong>{data.membership.level1_count}</strong> 人
                        </span>
                        <span>
                          二级 <strong>{data.membership.level2_count}</strong> 人
                        </span>
                        <span>
                          三级 <strong>{data.membership.level3_count}</strong> 人
                        </span>
                      </Space>
                    ),
                  },
                ]}
              />
            </>
          )}

          {/* 消费统计与最近订单 */}
          {canReadOrders && data.orders && (
            <>
              <Flex justify="space-between" align="center" style={{ marginTop: 4 }}>
                <Typography.Text strong>消费统计与最近订单</Typography.Text>
                <Button
                  size="small"
                  icon={<ShoppingCartOutlined />}
                  onClick={() => {
                    onClose();
                    history.push(`/trade/orders?user_id=${user.id}`);
                  }}
                >
                  查看全部订单
                </Button>
              </Flex>

              <Descriptions
                size="small"
                bordered
                column={{ xs: 2, sm: 4 }}
                items={[
                  { key: "total", label: "累计订单", children: <strong>{data.orders.total_count}</strong> },
                  { key: "paid", label: "已付款单数", children: <strong>{data.orders.paid_count}</strong> },
                  {
                    key: "gross",
                    label: "累计成交总额",
                    children: (
                      <Typography.Text strong style={{ color: "#389e0d" }}>
                        ¥{data.orders.gross_paid_amount}
                      </Typography.Text>
                    ),
                  },
                  {
                    key: "pending_redemption",
                    label: "待到店核销",
                    children: (
                      <Typography.Text type={(data.orders.pending_redemption_count ?? 0) > 0 ? "warning" : "secondary"}>
                        {data.orders.pending_redemption_count ?? 0} 单
                      </Typography.Text>
                    ),
                  },
                ]}
              />

              <Table<UserRecentOrderRead>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={data.orders.recent_orders}
                columns={recentOrderColumns.map((col) => ({
                  ...col,
                  onHeaderCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
                  onCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
                }))}
                scroll={{ x: "max-content" }}
              />
            </>
          )}
        </Space>
      )}
    </Drawer>
  );
}
