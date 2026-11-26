import type { AdminUserRead } from "@pinjie/api-client";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  HomeOutlined,
  LaptopOutlined,
  PoweroffOutlined,
  ShopOutlined,
  StopOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { ProTable } from "@ant-design/pro-components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Flex,
  Form,
  Input,
  Modal,
  Pagination,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import { useMemo, useState } from "react";

import { AdminAvatar } from "@/components/AdminAvatar";
import { MemberHistoryDrawer, type MemberHistoryUser } from "@/components/MemberHistoryDrawer";
import { PageFrame, QueryState, formatTime } from "@/components/PageFrame";
import { PointsLedgerDrawer, type PointsLedgerUser } from "@/components/PointsLedgerDrawer";
import { StandardConfirmModal } from "@/components/StandardConfirmModal";
import { StatusToggleTag } from "@/components/StatusToggleTag";
import { AvatarUploader } from "@/components/Uploader";
import { WalletLedgerDrawer, type WalletLedgerUser, type WalletTrackType } from "@/components/WalletLedgerDrawer";
import { canAccess, useCurrentAdmin } from "@/features/auth";
import { MerchantEditModal, PropertyOperatorEditModal } from "@/features/local-commerce";
import { adminApi } from "@/lib/api/admin";
import { commerceApi } from "@/lib/api/commerce";
import { errorMessage } from "@/lib/api/http";
import { formatPhoneForDisplay } from "@/lib/phone";
import { useLockedMutation } from "@/lib/useLockedMutation";
import { formatUserPrimaryName, formatUsernameForList, isWechatGeneratedUsername } from "@/lib/user-display";

import { UserDetailDrawer } from "./UserDetailDrawer";

type UserLifecycle = "all" | "active" | "inactive" | "deleted";
type UserBusinessRole = "all" | "member_only" | "merchant" | "property";

function hasPositiveAmount(value?: string | null): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function deletionReasonLabel(reason: string | null): string {
  if (reason === "admin_deleted") return "管理员删除";
  if (reason === "self_deleted") return "用户注销";
  return reason || "-";
}

function deletionActorLabel(actorType: string | null): string {
  if (actorType === "admin") return "管理员";
  if (actorType === "user") return "用户本人";
  if (actorType === "system") return "系统";
  return actorType || "-";
}

export function UsersPage() {
  const { message } = App.useApp();
  const current = useCurrentAdmin();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [lifecycle, setLifecycle] = useState<UserLifecycle>("all");
  const [businessRole, setBusinessRole] = useState<UserBusinessRole>("all");
  const [memberLevelFilter, setMemberLevelFilter] = useState<string>("all");
  const [selected, setSelected] = useState<AdminUserRead | null>(null);
  const [sessionPage, setSessionPage] = useState(1);
  const [editing, setEditing] = useState<AdminUserRead | null>(null);
  const [editingMerchantId, setEditingMerchantId] = useState<string | null>(null);
  const [editingOperatorId, setEditingOperatorId] = useState<string | null>(null);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [pointsUser, setPointsUser] = useState<PointsLedgerUser | null>(null);
  const [memberHistoryUser, setMemberHistoryUser] = useState<MemberHistoryUser | null>(null);
  const [walletDrawerState, setWalletDrawerState] = useState<{
    open: boolean;
    user: WalletLedgerUser | null;
    walletType: WalletTrackType;
  }>({ open: false, user: null, walletType: "commission" });
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [uploadingEditAvatar, setUploadingEditAvatar] = useState(false);
  const [removingEditAvatar, setRemovingEditAvatar] = useState(false);
  const [editForm] = Form.useForm<{ display_name?: string; avatar?: string | null }>();
  const [deleteReasonForm] = Form.useForm<{ deletion_reason?: string }>();
  const editAvatar = Form.useWatch("avatar", editForm);
  const users = useQuery({
    queryKey: ["admin-users", page, search, lifecycle, businessRole, memberLevelFilter],
    queryFn: () =>
      adminApi.users({
        page,
        search: search || undefined,
        lifecycle,
        businessRole,
        memberLevelId: memberLevelFilter !== "all" ? memberLevelFilter : undefined,
      }),
  });
  const canUpdate = canAccess(current, "users:update");
  const canDelete = canAccess(current, "users:delete");
  const canRestore = canAccess(current, "users:restore");
  const canReadPoints = canAccess(current, "points:read");
  const canAdjustPoints = canAccess(current, "points:adjust");
  const showPointsColumn = canReadPoints || canAdjustPoints;
  const canReadMembers = canAccess(current, "members:read");
  const canReadMemberLevels = canAccess(current, "member-levels:read");
  const canFilterMemberLevel = canReadMembers || canReadMemberLevels;
  const canReadWallets = canAccess(current, "wallets:read");
  const canReadSessions = canAccess(current, "users:sessions:read");
  const canManageMerchant = canAccess(current, "merchants:read") && canAccess(current, "merchants:update");
  const canManageProperty =
    canAccess(current, "property-operators:read") && canAccess(current, "property-operators:update");
  const memberLevels = useQuery({
    queryKey: ["member-level-options"],
    queryFn: () => commerceApi.memberLevelOptions(),
    enabled: canReadMemberLevels,
  });
  const levelNameMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const item of memberLevels.data ?? []) {
      map[item.id] = item.name;
    }
    return map;
  }, [memberLevels.data]);
  const sessions = useQuery({
    queryKey: ["admin-user-sessions", selected?.id, sessionPage],
    queryFn: () => adminApi.userSessions(selected!.id, sessionPage),
    enabled: Boolean(selected) && canReadSessions,
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-user-overview"] });
  };
  const editMutation = useMutation({
    mutationFn: (values: { display_name?: string; avatar?: string | null }) =>
      adminApi.updateUser(editing!.id, {
        display_name: values.display_name,
        avatar: values.avatar ?? null,
      }),
    onSuccess: async () => {
      message.success("用户资料已更新");
      setEditing(null);
      setUploadingEditAvatar(false);
      setRemovingEditAvatar(false);
      await invalidate();
    },
  });
  const batchStatusMutation = useMutation({
    mutationFn: ({ userIds, isActive }: { userIds: string[]; isActive: boolean }) =>
      adminApi.setUserStatusBulk({ user_ids: userIds, is_active: isActive }),
    onSuccess: async (result, { isActive }) => {
      message.success(`已批量${isActive ? "启用" : "停用"} ${result.completed_count} 名用户`);
      setSelectedRowKeys([]);
      await invalidate();
    },
  });
  const statusMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminApi.setUserStatus(userId, isActive),
    onSuccess: async () => {
      message.success("账户状态已更新");
      await invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });
  const batchDeleteMutation = useMutation({
    mutationFn: ({ userIds, deletionReason }: { userIds: string[]; deletionReason?: string | null }) =>
      adminApi.deleteUsersBulk({ user_ids: userIds, deletion_reason: deletionReason ?? null }),
    onSuccess: async (result) => {
      message.success(`已将 ${result.completed_count} 名用户移入回收站`);
      setDeleteTargets(null);
      deleteReasonForm.resetFields();
      setSelectedRowKeys([]);
      await invalidate();
    },
  });
  const restoreMutation = useMutation({
    mutationFn: (userId: string) => adminApi.restoreUser(userId),
    onSuccess: async () => {
      message.success("用户已恢复，账户保持停用");
      await invalidate();
    },
  });
  const batchRestoreMutation = useMutation({
    mutationFn: (userIds: string[]) => adminApi.restoreUsersBulk({ user_ids: userIds }),
    onSuccess: async (result) => {
      message.success(`已恢复 ${result.completed_count} 名用户，账户保持停用`);
      setSelectedRowKeys([]);
      await invalidate();
    },
  });
  const revokeSessionsMutation = useLockedMutation({
    mutationFn: (userId: string) => adminApi.revokeUserSessions(userId),
    onSuccess: async (_, userId) => {
      message.success("会话已撤销");
      await queryClient.invalidateQueries({ queryKey: ["admin-user-sessions", userId] });
    },
    onError: async (error, userId) => {
      message.error(`会话撤销未确认：${errorMessage(error)}。请核对刷新后的会话状态，再决定是否重试。`);
      await queryClient.invalidateQueries({ queryKey: ["admin-user-sessions", userId] });
    },
  });
  const submitSearch = () => {
    setPage(1);
    setSelectedRowKeys([]);
    setSearch(searchDraft.trim());
  };
  const resetSearch = () => {
    setPage(1);
    setSelectedRowKeys([]);
    setSearch("");
    setSearchDraft("");
    setBusinessRole("all");
    setMemberLevelFilter("all");
  };
  const changeLifecycle = (value: UserLifecycle) => {
    setLifecycle(value);
    setPage(1);
    setSelectedRowKeys([]);
  };
  const changeBusinessRole = (value: UserBusinessRole) => {
    setBusinessRole(value);
    setPage(1);
    setSelectedRowKeys([]);
  };
  const changeMemberLevel = (value: string) => {
    setMemberLevelFilter(value);
    setPage(1);
    setSelectedRowKeys([]);
  };
  const beginBulkStatusChange = (isActive: boolean) => {
    const userIds = [...selectedRowKeys];
    void batchStatusMutation
      .mutateAsync({ userIds, isActive })
      .catch((error: unknown) => message.error(errorMessage(error)));
  };
  const beginBulkDelete = () => {
    setDeleteTargets([...selectedRowKeys]);
    deleteReasonForm.resetFields();
  };
  const beginBulkRestore = () => {
    const userIds = [...selectedRowKeys];
    void batchRestoreMutation.mutateAsync(userIds).catch((error: unknown) => message.error(errorMessage(error)));
  };

  return (
    <PageFrame title="用户管理" description="管理账户状态、回收站、基础资料与会话。">
      <QueryState loading={users.isLoading} error={users.isError ? errorMessage(users.error) : undefined} onRetry={() => void users.refetch()} />
      {users.data && (
        <ProTable<AdminUserRead>
          className="responsive-data-table"
          rowKey="id"
          headerTitle="用户列表"
          dataSource={users.data.items}
          search={false}
          options={{
            density: true,
            fullScreen: true,
            reload: () => void users.refetch(),
            setting: true,
          }}
          cardProps={false}
          rowSelection={
            (lifecycle === "deleted" ? canRestore : canUpdate || canDelete)
              ? {
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys.map(String)),
                  getCheckboxProps: (record) => ({
                    disabled: lifecycle === "deleted" && !record.can_restore,
                  }),
                }
              : false
          }
          tableAlertRender={({ selectedRowKeys: keys }) => <span>已选择 {keys.length} 项</span>}
          tableAlertOptionRender={({ onCleanSelected }) => lifecycle === "deleted" ? (
            <Space size={8} wrap={false}>
              <Button
                size="small"
                icon={<UndoOutlined />}
                loading={batchRestoreMutation.isPending}
                onClick={beginBulkRestore}
              >
                批量恢复
              </Button>
              <Button type="link" size="small" onClick={onCleanSelected}>取消选择</Button>
            </Space>
          ) : (
            <Space size={8} wrap={false}>
              {canUpdate && (
                <Button
                  size="small"
                  icon={<CheckCircleOutlined />}
                  disabled={batchStatusMutation.isPending || batchDeleteMutation.isPending}
                  loading={batchStatusMutation.isPending && batchStatusMutation.variables?.isActive}
                  onClick={() => beginBulkStatusChange(true)}
                >
                  批量启用
                </Button>
              )}
              {canUpdate && (
                <Button
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  disabled={batchStatusMutation.isPending || batchDeleteMutation.isPending}
                  loading={batchStatusMutation.isPending && !batchStatusMutation.variables?.isActive}
                  onClick={() => beginBulkStatusChange(false)}
                >
                  批量停用
                </Button>
              )}
              {canDelete && (
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={batchStatusMutation.isPending || batchDeleteMutation.isPending}
                  loading={batchDeleteMutation.isPending}
                  onClick={beginBulkDelete}
                >
                  批量删除
                </Button>
              )}
              <Button type="link" size="small" onClick={onCleanSelected}>取消选择</Button>
            </Space>
          )}
          toolBarRender={() => [(
            <div className="responsive-table-toolbar users-table-toolbar" key="user-toolbar">
              <Segmented<UserLifecycle>
                className="table-toolbar-desktop-lifecycle"
                aria-label="用户生命周期"
                options={[
                  { label: "全部", value: "all" },
                  { label: "启用", value: "active" },
                  { label: "停用", value: "inactive" },
                  { label: "回收站", value: "deleted" },
                ]}
                value={lifecycle}
                onChange={changeLifecycle}
              />
              <Select<UserLifecycle>
                className="table-toolbar-mobile-lifecycle"
                aria-label="用户生命周期（移动端）"
                options={[
                  { label: "全部用户", value: "all" },
                  { label: "启用用户", value: "active" },
                  { label: "停用用户", value: "inactive" },
                  { label: "用户回收站", value: "deleted" },
                ]}
                value={lifecycle}
                onChange={changeLifecycle}
              />
              <Select<UserBusinessRole>
                aria-label="业务身份筛选"
                style={{ width: 136 }}
                options={[
                  { label: "全部身份", value: "all" },
                  { label: "仅普通会员", value: "member_only" },
                  { label: "商家", value: "merchant" },
                  { label: "物业", value: "property" },
                ]}
                value={businessRole}
                onChange={changeBusinessRole}
              />
              {canFilterMemberLevel && (
                <Select<string>
                  aria-label="会员等级筛选"
                  style={{ width: 150 }}
                  loading={memberLevels.isLoading}
                  options={[
                    { label: "全部等级", value: "all" },
                    { label: "普通会员（无等级）", value: "none" },
                    ...(memberLevels.data ?? []).map((level) => ({
                      label: `${level.name}${level.is_active ? "" : "（停用）"}`,
                      value: level.id,
                    })),
                  ]}
                  value={memberLevelFilter}
                  onChange={changeMemberLevel}
                />
              )}
              <Input.Search
                className="table-toolbar-search"
                allowClear
                aria-label="搜索用户"
                placeholder="用户名、显示名称或手机号"
                style={{ width: 260 }}
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onSearch={submitSearch}
              />
              <Button className="table-toolbar-reset" onClick={resetSearch}>重置</Button>
            </div>
          )]}
          scroll={{ x: "max-content" }}
          pagination={{
            current: page,
            pageSize: 20,
            total: users.data.total,
            showSizeChanger: false,
            onChange: (nextPage) => {
              setPage(nextPage);
              setSelectedRowKeys([]);
            },
          }}
          columns={[
            {
              title: "用户",
              dataIndex: "username",
              onHeaderCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
              onCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
              render: (_, row) => {
                const primaryName = formatUserPrimaryName(row);
                const shortUsername = formatUsernameForList(row.username);
                const tooltipTitle = isWechatGeneratedUsername(row.username)
                  ? `完整用户名：${row.username}（点击查看用户综合详情）`
                  : "点击查看用户综合详情";
                return (
                  <Tooltip title={tooltipTitle}>
                    <button
                      type="button"
                      aria-label={`查看用户详情：${primaryName}`}
                      onClick={() => setDetailUserId(row.id)}
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: 0,
                        margin: 0,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 10,
                        textAlign: "left",
                      }}
                    >
                      <AdminAvatar
                        size={32}
                        admin={{
                          avatar: row.avatar ?? null,
                          display_name: row.display_name ?? null,
                          username: row.username,
                        }}
                      />
                      <div className="table-primary-cell">
                        <Typography.Text strong style={{ color: "#1677ff" }}>
                          {primaryName}
                        </Typography.Text>
                        <Typography.Text type="secondary">{shortUsername}</Typography.Text>
                      </div>
                    </button>
                  </Tooltip>
                );
              },
            },
            {
              title: "手机号",
              dataIndex: "phone_e164",
              width: 150,
              onHeaderCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
              onCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
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
              title: "业务身份",
              key: "business_roles",
              onHeaderCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
              onCell: () => ({ style: { whiteSpace: "nowrap", verticalAlign: "middle" } }),
              render: (_, row) => {
                const merchant = row.merchant_role;
                const property = row.property_role;
                if (!merchant && !property) {
                  return <Tag>普通会员</Tag>;
                }
                return (
                  <Space size={4} wrap={false}>
                    {merchant && (() => {
                      const canClickMerchant = canManageMerchant && lifecycle !== "deleted";
                      const tag = (
                        <Tag
                          color={merchant.is_active ? "blue" : "default"}
                          icon={canClickMerchant ? <ShopOutlined /> : undefined}
                          style={{
                            maxWidth: 180,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            verticalAlign: "middle",
                            marginInlineEnd: 0,
                            cursor: canClickMerchant ? "pointer" : undefined,
                          }}
                        >
                          商家：{merchant.name}{merchant.is_active ? "" : "（停用）"}
                        </Tag>
                      );
                      return (
                        <Tooltip
                          title={`商家：${merchant.name}${merchant.is_active ? "（启用）" : "（停用）"}${canClickMerchant ? "，点击管理商家授权" : ""}`}
                        >
                          {canClickMerchant ? (
                            <button
                              type="button"
                              aria-label={`管理商家授权：${merchant.name}`}
                              onClick={() => setEditingMerchantId(merchant.id)}
                              style={{
                                border: 0,
                                background: "transparent",
                                padding: 0,
                                margin: 0,
                                lineHeight: 1,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                              }}
                            >
                              {tag}
                            </button>
                          ) : tag}
                        </Tooltip>
                      );
                    })()}
                    {property && (() => {
                      const canClickProperty = canManageProperty && lifecycle !== "deleted";
                      const tag = (
                        <Tag
                          color={property.is_active ? "gold" : "default"}
                          icon={canClickProperty ? <HomeOutlined /> : undefined}
                          style={{
                            maxWidth: 180,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            verticalAlign: "middle",
                            marginInlineEnd: 0,
                            cursor: canClickProperty ? "pointer" : undefined,
                          }}
                        >
                          物业：{property.name}{property.is_active ? "" : "（停用）"}
                        </Tag>
                      );
                      return (
                        <Tooltip
                          title={`物业：${property.name}${property.is_active ? "（启用）" : "（停用）"}${canClickProperty ? "，点击管理物业授权" : ""}`}
                        >
                          {canClickProperty ? (
                            <button
                              type="button"
                              aria-label={`管理物业授权：${property.name}`}
                              onClick={() => setEditingOperatorId(property.id)}
                              style={{
                                border: 0,
                                background: "transparent",
                                padding: 0,
                                margin: 0,
                                lineHeight: 1,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                              }}
                            >
                              {tag}
                            </button>
                          ) : tag}
                        </Tooltip>
                      );
                    })()}
                  </Space>
                );
              },
            },
            ...(canReadMembers
              ? [
                  {
                    title: "会员等级",
                    key: "member_level",
                    onHeaderCell: () => ({ style: { whiteSpace: "nowrap" as const, verticalAlign: "middle" as const } }),
                    onCell: () => ({ style: { whiteSpace: "nowrap" as const, verticalAlign: "middle" as const } }),
                    render: (_: unknown, row: AdminUserRead) => {
                      const level = row.member_level;
                      const label = level?.level_id
                        ? `${level.level_name || level.level_code || level.level_id.slice(0, 8)}${
                            level.level_is_active === false ? "（停用）" : ""
                          }`
                        : "普通";
                      const tagColor = level?.level_id ? (level.level_is_active === false ? "default" : "gold") : "default";
                      return (
                        <Tooltip title="点击查看会员等级变更与资格贡献历史">
                          <button
                            type="button"
                            aria-label={`查看会员等级历史：${row.display_name || row.username}`}
                            onClick={() =>
                              setMemberHistoryUser({
                                user_id: row.id,
                                username: row.username,
                                display_name: row.display_name ?? null,
                                phone_e164: row.phone_e164 ?? null,
                              })
                            }
                            style={{
                              border: 0,
                              background: "transparent",
                              padding: 0,
                              margin: 0,
                              lineHeight: 1,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            <Tag color={tagColor} style={{ marginInlineEnd: 0, cursor: "pointer" }}>
                              {label}
                            </Tag>
                          </button>
                        </Tooltip>
                      );
                    },
                  },
                ]
              : []),
            ...(showPointsColumn
              ? [
                  {
                    title: "积分",
                    key: "points",
                    onHeaderCell: () => ({ style: { whiteSpace: "nowrap" as const, verticalAlign: "middle" as const } }),
                    onCell: () => ({ style: { whiteSpace: "nowrap" as const, verticalAlign: "middle" as const } }),
                    render: (_: unknown, row: AdminUserRead) => {
                      const openLedger = () =>
                        setPointsUser({
                          user_id: row.id,
                          username: row.username,
                          display_name: row.display_name ?? null,
                          phone_e164: row.phone_e164 ?? null,
                          phone_verified_at: row.phone_verified_at ?? null,
                          is_active: row.is_active,
                          deleted_at: row.deleted_at ?? null,
                          ...(row.points_summary
                            ? {
                                available_points: row.points_summary.available_points,
                                frozen_points: row.points_summary.frozen_points,
                                debt_points: row.points_summary.debt_points,
                              }
                            : {}),
                        });

                      if (!canReadPoints) {
                        return (
                          <Tooltip title="缺少积分查看权限，点击执行积分调整">
                            <Button
                              type="link"
                              size="small"
                              style={{ paddingInline: 0, height: "auto" }}
                              onClick={openLedger}
                            >
                              积分操作
                            </Button>
                          </Tooltip>
                        );
                      }

                      const summary = row.points_summary;
                      const available = summary?.available_points ?? 0;
                      const frozen = summary?.frozen_points ?? 0;
                      const debt = summary?.debt_points ?? 0;
                      const tooltipTitle = summary
                        ? `可用 ${available} / 冻结 ${frozen} / 欠积分 ${debt}（点击查看积分流水）`
                        : "尚未初始化积分账户（当前余额 0），点击查看积分流水";

                      return (
                        <Tooltip title={tooltipTitle}>
                          <Space size={6} wrap={false}>
                            <Button
                              type="link"
                              size="small"
                              style={{
                                paddingInline: 0,
                                height: "auto",
                                fontWeight: 600,
                                color: available > 0 ? "#389e0d" : undefined,
                              }}
                              onClick={openLedger}
                            >
                              {available}
                            </Button>
                            {frozen > 0 && (
                              <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                                冻 {frozen}
                              </Tag>
                            )}
                            {debt > 0 && (
                              <Tag color="error" style={{ marginInlineEnd: 0 }}>
                                欠 {debt}
                              </Tag>
                            )}
                          </Space>
                        </Tooltip>
                      );
                    },
                  },
                ]
              : []),
            ...(canReadWallets
              ? [
                  {
                    title: "佣金余额",
                    key: "commission_wallet",
                    onHeaderCell: () => ({ style: { whiteSpace: "nowrap" as const, verticalAlign: "middle" as const } }),
                    onCell: () => ({ style: { whiteSpace: "nowrap" as const, verticalAlign: "middle" as const } }),
                    render: (_: unknown, row: AdminUserRead) => {
                      const commission = row.wallet_summary?.commission;
                      const consumption = row.wallet_summary?.consumption;
                      const available = commission?.available_amount ?? "0.00";
                      const frozen = commission?.frozen_amount ?? "0.00";
                      const debt = commission?.debt_amount ?? "0.00";
                      const consumptionAvail = consumption?.available_amount ?? "0.00";
                      const tooltipText = commission
                        ? `佣金钱包：可用 ¥${available} / 冻结 ¥${frozen} / 欠款 ¥${debt}；消费钱包：可用 ¥${consumptionAvail}（点击查看钱包流水）`
                        : `尚未初始化佣金钱包（余额 ¥0.00）；消费钱包：¥${consumptionAvail}（点击查看钱包流水）`;

                      return (
                        <Tooltip title={tooltipText}>
                          <Space size={6} wrap={false}>
                            <Button
                              type="link"
                              size="small"
                              style={{
                                paddingInline: 0,
                                height: "auto",
                                fontWeight: 600,
                                color: hasPositiveAmount(available) ? "#389e0d" : undefined,
                              }}
                              onClick={() =>
                                setWalletDrawerState({
                                  open: true,
                                  user: {
                                    user_id: row.id,
                                    username: row.username,
                                    display_name: row.display_name ?? null,
                                    phone_e164: row.phone_e164 ?? null,
                                  },
                                  walletType: "commission",
                                })
                              }
                            >
                              ¥{available}
                            </Button>
                            {hasPositiveAmount(frozen) && (
                              <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                                冻 ¥{frozen}
                              </Tag>
                            )}
                            {hasPositiveAmount(debt) && (
                              <Tag color="error" style={{ marginInlineEnd: 0 }}>
                                欠 ¥{debt}
                              </Tag>
                            )}
                          </Space>
                        </Tooltip>
                      );
                    },
                  },
                ]
              : []),
            { title: "状态", dataIndex: "is_active", width: 110, render: (_value, row) => {
              if (lifecycle === "deleted") {
                if (row.can_restore) return <Tag color="warning">可恢复</Tag>;
                return <Tag>不可恢复</Tag>;
              }
              return (
                <StatusToggleTag
                  active={row.is_active}
                  ariaLabel={`${row.is_active ? "停用" : "启用"}用户：${row.username}`}
                  interactive={canUpdate}
                  loading={statusMutation.isPending && statusMutation.variables?.userId === row.id}
                  readOnlyReason="没有修改用户的权限"
                  onToggle={() => statusMutation.mutate({ userId: row.id, isActive: !row.is_active })}
                />
              );
            } },
            { title: "创建时间", dataIndex: "created_at", width: 170, responsive: ["xl"], render: (_, row) => formatTime(row.created_at) },
            ...(lifecycle === "deleted" ? [
              { title: "删除时间", dataIndex: "deleted_at", width: 170, render: (_: unknown, row: AdminUserRead) => formatTime(row.deleted_at) },
              { title: "删除主体", dataIndex: "deleted_by_type", width: 100, render: (_: unknown, row: AdminUserRead) => deletionActorLabel(row.deleted_by_type) },
              { title: "删除原因", dataIndex: "deletion_reason", width: 120, render: (_: unknown, row: AdminUserRead) => deletionReasonLabel(row.deletion_reason) },
            ] : []),
            { title: "操作", key: "actions", width: "1%", onHeaderCell: () => ({ style: { whiteSpace: "nowrap" } }), onCell: () => ({ style: { whiteSpace: "nowrap" } }), render: (_, row) => lifecycle === "deleted" ? (
              canRestore && (
                <Button
                  type="link"
                  size="small"
                  icon={<UndoOutlined />}
                  disabled={!row.can_restore}
                  loading={restoreMutation.isPending && restoreMutation.variables === row.id}
                  onClick={() => void restoreMutation.mutateAsync(row.id).catch((error: unknown) => message.error(errorMessage(error)))}
                >
                  恢复
                </Button>
              )
            ) : (
              (() => {
                const moreItems: MenuProps["items"] = [
                  ...(canReadSessions
                    ? [
                        {
                          key: "sessions",
                          label: "查看会话",
                          icon: <LaptopOutlined />,
                          disabled: revokeSessionsMutation.isPending,
                          onClick: () => {
                            setSessionPage(1);
                            setSelected(row);
                          },
                        },
                      ]
                    : []),
                  ...(canDelete
                    ? [
                        {
                          key: "delete",
                          label: "移入回收站",
                          icon: <DeleteOutlined />,
                          danger: true,
                          disabled:
                            batchDeleteMutation.isPending &&
                            batchDeleteMutation.variables?.userIds.length === 1 &&
                            batchDeleteMutation.variables.userIds[0] === row.id,
                          onClick: () => {
                            setDeleteTargets([row.id]);
                            deleteReasonForm.resetFields();
                          },
                        },
                      ]
                    : []),
                ];

                return (
                  <Space className="table-actions" size={[4, 0]} wrap={false}>
                    {canUpdate && (
                      <Button
                        type="link"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                          editMutation.reset();
                          setUploadingEditAvatar(false);
                          setRemovingEditAvatar(false);
                          setEditing(row);
                          editForm.setFieldsValue({
                            display_name: row.display_name ?? undefined,
                            avatar: row.avatar ?? null,
                          });
                        }}
                      >
                        编辑
                      </Button>
                    )}
                    {canUpdate && (
                      <Button
                        type="link"
                        size="small"
                        icon={<PoweroffOutlined />}
                        danger={row.is_active}
                        loading={statusMutation.isPending && statusMutation.variables?.userId === row.id}
                        disabled={statusMutation.isPending && statusMutation.variables?.userId === row.id}
                        onClick={() => statusMutation.mutate({ userId: row.id, isActive: !row.is_active })}
                      >
                        {row.is_active ? "停用" : "启用"}
                      </Button>
                    )}
                    {moreItems.length > 0 && (
                      <Dropdown
                        menu={{ items: moreItems, style: { minWidth: 136, whiteSpace: "nowrap" } }}
                        trigger={["click"]}
                        placement="bottomRight"
                      >
                        <Button
                          type="link"
                          size="small"
                          icon={<EllipsisOutlined />}
                          aria-label={`更多操作：${row.username}`}
                        >
                          更多
                        </Button>
                      </Dropdown>
                    )}
                  </Space>
                );
              })()
            ) },
          ]}
        />
      )}

      <Modal
        open={Boolean(editing)}
        title="编辑用户资料"
        okText="保存"
        confirmLoading={editMutation.isPending}
        closable={!editMutation.isPending && !uploadingEditAvatar}
        keyboard={!editMutation.isPending && !uploadingEditAvatar}
        mask={{ closable: !editMutation.isPending && !uploadingEditAvatar }}
        cancelButtonProps={{ disabled: editMutation.isPending || uploadingEditAvatar }}
        okButtonProps={{ disabled: removingEditAvatar || uploadingEditAvatar }}
        onCancel={() => {
          if (editMutation.isPending || uploadingEditAvatar) return;
          setEditing(null);
          setRemovingEditAvatar(false);
          editMutation.reset();
        }}
        onOk={() => {
          if (uploadingEditAvatar || removingEditAvatar) return;
          editForm.submit();
        }}
      >
        {editMutation.isError && <Alert showIcon type="error" title={errorMessage(editMutation.error)} style={{ marginBottom: 16 }} />}
        {editing && (
          <Descriptions
            size="small"
            bordered
            column={1}
            style={{ marginBottom: 16 }}
            items={[
              {
                key: "username",
                label: "用户名",
                children: <Typography.Text copyable>{editing.username}</Typography.Text>,
              },
              {
                key: "phone",
                label: "手机号",
                children: (() => {
                  const phone = formatPhoneForDisplay(editing.phone_e164);
                  return phone ? <Typography.Text copyable>{phone}</Typography.Text> : <Tag style={{ marginInlineEnd: 0 }}>未绑定</Tag>;
                })(),
              },
            ]}
          />
        )}
        <Form
          form={editForm}
          layout="vertical"
          disabled={editMutation.isPending || removingEditAvatar}
          onFinish={(values) => {
            if (uploadingEditAvatar || removingEditAvatar) return;
            editMutation.mutate(values);
          }}
        >
          <Form.Item label="头像">
            <Space orientation="vertical" size={4}>
              <Form.Item name="avatar" noStyle>
                <AvatarUploader
                  disabled={editMutation.isPending || removingEditAvatar}
                  onUploadingChange={setUploadingEditAvatar}
                />
              </Form.Item>
              {editAvatar ? (
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={editMutation.isPending || removingEditAvatar || uploadingEditAvatar}
                  onClick={() => setRemovingEditAvatar(true)}
                >
                  移除头像
                </Button>
              ) : null}
            </Space>
          </Form.Item>
          <Form.Item label="显示名称" name="display_name">
            <Input maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>

      <StandardConfirmModal
        open={removingEditAvatar && Boolean(editing)}
        title={`确认移除用户“${editing ? formatUserPrimaryName(editing) : ""}”的头像`}
        description="确认后将清空编辑表单中的头像，保存用户资料后生效。原图片资产仍保留，其他资料不受影响。"
        loading={editMutation.isPending}
        onCancel={() => setRemovingEditAvatar(false)}
        onConfirm={async () => {
          editForm.setFieldValue("avatar", null);
          setRemovingEditAvatar(false);
        }}
      />

      <StandardConfirmModal
        open={Boolean(deleteTargets)}
        title={`确认将 ${deleteTargets?.length ?? 0} 名用户移入回收站`}
        description="确认后所选账户将被停用，现有登录会话将被撤销。用户资料保留，可在回收站恢复，恢复后仍为停用状态。"
        loading={batchDeleteMutation.isPending}
        onCancel={() => { setDeleteTargets(null); deleteReasonForm.resetFields(); }}
        onConfirm={async () => {
          const targets = deleteTargets;
          if (!targets?.length) throw new Error("请选择要移入回收站的用户");
          const { deletion_reason } = await deleteReasonForm.validateFields();
          await batchDeleteMutation.mutateAsync({ userIds: targets, deletionReason: deletion_reason?.trim() || null });
        }}
      >
        <Form
          form={deleteReasonForm}
          layout="vertical"
          disabled={batchDeleteMutation.isPending}
        >
          <Form.Item label="删除原因" name="deletion_reason" extra="可留空，最多 100 个字符">
            <Input.TextArea maxLength={100} showCount autoFocus />
          </Form.Item>
        </Form>
      </StandardConfirmModal>

      <Drawer open={Boolean(selected)} closable={!revokeSessionsMutation.isPending} keyboard={!revokeSessionsMutation.isPending} mask={{ closable: !revokeSessionsMutation.isPending }} styles={{ wrapper: { width: 560 } }} title={selected ? `${selected.username} 的会话` : "用户会话"} onClose={() => { if (revokeSessionsMutation.isPending) return; setSelected(null); setSessionPage(1); }} extra={selected && canAccess(current, "users:sessions:revoke") ? <Button danger disabled={sessions.isFetching || sessions.isError || !sessions.data} loading={revokeSessionsMutation.isPending} onClick={() => revokeSessionsMutation.mutate(selected.id)}>撤销全部</Button> : null}>
        <QueryState loading={sessions.isLoading} error={sessions.isError ? errorMessage(sessions.error) : undefined} empty={sessions.data?.items.length === 0} onRetry={() => void sessions.refetch()} />
        {!sessions.isError && sessions.data?.items.map((session) => <div className="session-row" key={session.id}><Flex justify="space-between"><Typography.Text strong>{session.device_name || "未知设备"}</Typography.Text>{session.revoked_at ? <Tag>已撤销</Tag> : <Tag color="success">有效</Tag>}</Flex><Typography.Text type="secondary">{session.ip_masked || "未知地址"} · 最近活动 {formatTime(session.last_seen_at)}</Typography.Text></div>)}
        {!sessions.isError && sessions.data && sessions.data.total_pages > 1 && <Pagination disabled={revokeSessionsMutation.isPending} current={sessionPage} pageSize={sessions.data.page_size} total={sessions.data.total} showSizeChanger={false} onChange={setSessionPage} />}
      </Drawer>

      <UserDetailDrawer
        open={Boolean(detailUserId)}
        userId={detailUserId}
        onClose={() => setDetailUserId(null)}
        onSelectUser={(nextId) => setDetailUserId(nextId)}
        onOpenPoints={(user) => {
          setWalletDrawerState((prev) => ({ ...prev, open: false, user: null }));
          setMemberHistoryUser(null);
          setPointsUser(user);
        }}
        onOpenWallet={(user, walletType) => {
          setPointsUser(null);
          setMemberHistoryUser(null);
          setWalletDrawerState({ open: true, user, walletType });
        }}
        onOpenMemberHistory={(user) => {
          setPointsUser(null);
          setWalletDrawerState((prev) => ({ ...prev, open: false, user: null }));
          setMemberHistoryUser(user);
        }}
        onEditMerchant={(merchantId) => setEditingMerchantId(merchantId)}
        onEditProperty={(operatorId) => setEditingOperatorId(operatorId)}
      />

      <PointsLedgerDrawer
        open={Boolean(pointsUser)}
        user={pointsUser}
        onClose={() => setPointsUser(null)}
        onAdjusted={() => {
          void queryClient.invalidateQueries({ queryKey: ["admin-user-overview"] });
        }}
      />

      <WalletLedgerDrawer
        open={walletDrawerState.open}
        user={walletDrawerState.user}
        initialWalletType={walletDrawerState.walletType}
        onClose={() => setWalletDrawerState((prev) => ({ ...prev, open: false, user: null }))}
      />

      <MemberHistoryDrawer
        open={Boolean(memberHistoryUser)}
        user={memberHistoryUser}
        levelNameMap={levelNameMap}
        onClose={() => setMemberHistoryUser(null)}
      />

      {editingMerchantId && (
        <MerchantEditModal
          merchantId={editingMerchantId}
          close={() => setEditingMerchantId(null)}
          done={async (savedId) => {
            await invalidate();
            await queryClient.invalidateQueries({ queryKey: ["local-merchants"] });
            if (savedId) {
              await queryClient.invalidateQueries({ queryKey: ["local-merchant-detail", savedId] });
            }
            message.success("商家授权已更新");
          }}
        />
      )}

      {editingOperatorId && (
        <PropertyOperatorEditModal
          operatorId={editingOperatorId}
          close={() => setEditingOperatorId(null)}
          done={async (savedId) => {
            await invalidate();
            await queryClient.invalidateQueries({ queryKey: ["property-operators"] });
            if (savedId) {
              await queryClient.invalidateQueries({ queryKey: ["property-operator-detail", savedId] });
            }
            message.success("物业授权已更新");
          }}
        />
      )}

    </PageFrame>
  );
}

export default UsersPage;
