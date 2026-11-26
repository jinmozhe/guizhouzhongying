import { useEffect, useState } from "react";
import { Alert, Drawer, Table, Tabs, Tag, Tooltip, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";
import type { MemberLevelEventRead, MembershipQualificationEventRead } from "@pinjie/api-client";

import { QueryState, formatTime } from "@/components/PageFrame";
import { canAccess, useCurrentAdmin } from "@/lib/auth-context";
import { commerceApi } from "@/lib/api/commerce";
import { errorMessage } from "@/lib/api/http";
import { formatPhoneForDisplay } from "@/lib/phone";

export type MemberHistoryUser = {
  user_id: string;
  username?: string | null;
  display_name?: string | null;
  phone_e164?: string | null;
};

type MemberHistoryDrawerProps = {
  open: boolean;
  user: MemberHistoryUser | null;
  levelNameMap?: Record<string, string>;
  zIndex?: number;
  onClose: () => void;
};

const TRIGGER_LABEL: Record<string, { label: string; color: string }> = {
  manual: { label: "人工调整", color: "blue" },
  order: { label: "订单成交", color: "green" },
  refund: { label: "退款重算", color: "volcano" },
  invite: { label: "邀请达标", color: "purple" },
  policy_reassessment: { label: "政策重评", color: "gold" },
  points: { label: "积分达标", color: "cyan" },
};

const METRIC_META: Record<string, { label: string; color: string }> = {
  consumption: { label: "消费金额", color: "blue" },
  invite_count: { label: "邀请人数", color: "purple" },
  points: { label: "积分贡献", color: "orange" },
};

const SOURCE_LABEL: Record<string, string> = {
  order_confirm: "订单成交",
  refund: "整单退款冲回",
  invite_validated: "有效邀请确认",
  points_grant: "后台授予积分",
  points_reverse: "后台冲销积分",
  manual: "人工调整",
};

function userDisplayName(user: Pick<MemberHistoryUser, "display_name" | "username" | "user_id">): string {
  return user.display_name || user.username || user.user_id;
}

/**
 * 跨页面复用的会员等级变更历史与资格贡献记录双 Tab 抽屉。
 */
export function MemberHistoryDrawer({ open, user, levelNameMap = {}, zIndex = 1010, onClose }: MemberHistoryDrawerProps) {
  const admin = useCurrentAdmin();
  const canRead = canAccess(admin, "members:read");
  const [activeTab, setActiveTab] = useState<"levels" | "qualifications">("levels");
  const [levelPage, setLevelPage] = useState(1);
  const [qualPage, setQualPage] = useState(1);

  useEffect(() => {
    if (open) {
      setActiveTab("levels");
      setLevelPage(1);
      setQualPage(1);
    }
  }, [open, user?.user_id]);

  const levelQuery = useQuery({
    queryKey: ["level-events", user?.user_id, levelPage],
    queryFn: () => commerceApi.levelEvents(user!.user_id, levelPage),
    enabled: open && Boolean(user?.user_id) && canRead && activeTab === "levels",
  });

  const qualQuery = useQuery({
    queryKey: ["qualification-events", user?.user_id, qualPage],
    queryFn: () => commerceApi.qualificationEvents(user!.user_id, qualPage),
    enabled: open && Boolean(user?.user_id) && canRead && activeTab === "qualifications",
  });

  const renderLevelTag = (levelId?: string | null, highlight = false) => {
    if (!levelId) return <Tag>普通会员</Tag>;
    const resolved = levelNameMap[levelId];
    if (resolved) {
      return <Tag color={highlight ? "gold" : "default"}>{resolved}</Tag>;
    }
    return (
      <Tooltip title={`等级 ID：${levelId}`}>
        <Tag color={highlight ? "gold" : "default"}>{levelId.slice(0, 8)}</Tag>
      </Tooltip>
    );
  };

  const levelColumns: ColumnsType<MemberLevelEventRead> = [
    {
      title: "原等级",
      dataIndex: "from_level_id",
      key: "from_level_id",
      render: (value: string | null) => renderLevelTag(value, false),
    },
    {
      title: "变更为",
      dataIndex: "to_level_id",
      key: "to_level_id",
      render: (value: string | null) => renderLevelTag(value, true),
    },
    {
      title: "触发方式",
      dataIndex: "trigger_type",
      key: "trigger_type",
      render: (value: string) => {
        const meta = TRIGGER_LABEL[value] ?? { label: value, color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "档案版本",
      dataIndex: "profile_revision",
      key: "profile_revision",
      width: 90,
      render: (v: number) => `v${v}`,
    },
    {
      title: "变更时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (value: string) => formatTime(value),
    },
  ];

  const qualColumns: ColumnsType<MembershipQualificationEventRead> = [
    {
      title: "指标类型",
      dataIndex: "metric",
      key: "metric",
      render: (value: string) => {
        const meta = METRIC_META[value] ?? { label: value, color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "贡献变动",
      key: "delta",
      render: (_, row) => {
        if (row.amount_delta !== null && row.amount_delta !== undefined) {
          const num = Number(row.amount_delta);
          return (
            <Typography.Text type={num >= 0 ? "success" : "danger"}>
              {num >= 0 ? `+¥${row.amount_delta}` : `-¥${String(row.amount_delta).replace(/^-/, "")}`}
            </Typography.Text>
          );
        }
        if (row.count_delta !== null && row.count_delta !== undefined) {
          return (
            <Typography.Text type={row.count_delta >= 0 ? "success" : "danger"}>
              {row.count_delta >= 0 ? `+${row.count_delta}` : row.count_delta}
            </Typography.Text>
          );
        }
        return "-";
      },
    },
    {
      title: "来源类型",
      dataIndex: "source_type",
      key: "source_type",
      render: (value: string) => SOURCE_LABEL[value] ?? value,
    },
    {
      title: "关联单据",
      key: "source_id",
      render: (_, row) => {
        const target = row.order_id ?? row.source_id;
        return (
          <Typography.Text copyable={{ text: target }} type="secondary">
            {target.slice(0, 8)}
          </Typography.Text>
        );
      },
    },
    {
      title: "发生时间",
      dataIndex: "occurred_at",
      key: "occurred_at",
      render: (value: string) => formatTime(value),
    },
  ];

  const drawerTitle = user
    ? `会员等级与资格历史 - ${userDisplayName(user)}${
        formatPhoneForDisplay(user.phone_e164) ? `（${formatPhoneForDisplay(user.phone_e164)}）` : ""
      }`
    : "会员等级与资格历史";

  return (
    <Drawer title={<Typography.Text strong>{drawerTitle}</Typography.Text>} open={open} onClose={onClose} size={860} zIndex={zIndex}>
      {!canRead ? (
        <Alert
          type="warning"
          showIcon
          title="当前账号缺少会员查看权限（members:read）"
          description="无法查看该用户的会员等级变更与资格贡献记录。"
        />
      ) : (
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as "levels" | "qualifications")}
          items={[
            {
              key: "levels",
              label: "等级变更历史",
              children: (
                <>
                  <QueryState
                    loading={false}
                    error={levelQuery.isError ? errorMessage(levelQuery.error) : undefined}
                    onRetry={() => void levelQuery.refetch()}
                  />
                  {!levelQuery.isError && (
                    <Table<MemberLevelEventRead>
                      rowKey="id"
                      loading={levelQuery.isLoading || levelQuery.isFetching}
                      dataSource={levelQuery.data?.items ?? []}
                      columns={levelColumns.map((col) => ({
                        ...col,
                        onHeaderCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
                        onCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
                      }))}
                      scroll={{ x: "max-content" }}
                      pagination={{
                        current: levelPage,
                        pageSize: 20,
                        showSizeChanger: false,
                        total: levelQuery.data?.total ?? 0,
                        onChange: setLevelPage,
                        showTotal: (total) => `共 ${total} 条等级变更`,
                      }}
                    />
                  )}
                </>
              ),
            },
            {
              key: "qualifications",
              label: "资格贡献记录",
              children: (
                <>
                  <QueryState
                    loading={false}
                    error={qualQuery.isError ? errorMessage(qualQuery.error) : undefined}
                    onRetry={() => void qualQuery.refetch()}
                  />
                  {!qualQuery.isError && (
                    <Table<MembershipQualificationEventRead>
                      rowKey="id"
                      loading={qualQuery.isLoading || qualQuery.isFetching}
                      dataSource={qualQuery.data?.items ?? []}
                      columns={qualColumns.map((col) => ({
                        ...col,
                        onHeaderCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
                        onCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
                      }))}
                      scroll={{ x: "max-content" }}
                      pagination={{
                        current: qualPage,
                        pageSize: 20,
                        showSizeChanger: false,
                        total: qualQuery.data?.total ?? 0,
                        onChange: setQualPage,
                        showTotal: (total) => `共 ${total} 条资格贡献`,
                      }}
                    />
                  )}
                </>
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
