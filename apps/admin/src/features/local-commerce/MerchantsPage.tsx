import type { MerchantInput, MerchantRead } from "@pinjie/api-client";
import { CheckOutlined, EditOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Image, Input, InputNumber, Space, Switch, Tag } from "antd";
import { useState } from "react";
import { EditorModal } from "@/components/EditorModal";
import { PageFrame } from "@/components/PageFrame";
import { ResourceTable } from "@/components/ResourceTable";
import { RichTextEditor } from "@/components/RichTextEditor";
import { BrandLogoPicker } from "@/components/Uploader";
import { canAccess, useCurrentAdmin } from "@/features/auth";
import { localCommerceApi } from "@/lib/api/local-commerce";
import { errorMessage } from "@/lib/api/http";

function Editor({ target, close, done }: { target: MerchantRead | null; close: () => void; done: () => Promise<void> }) {
  const [form] = Form.useForm<MerchantInput>();
  const [logo, setLogo] = useState(target?.logo_url ?? null);
  return <EditorModal title={target ? "编辑商家" : "新增商家"} onClose={close} onSave={async () => {
    const values = await form.validateFields();
    if (target) await localCommerceApi.updateMerchant(target.id, { ...values, revision: target.revision });
    else await localCommerceApi.createMerchant(values);
    await done(); close();
  }}>
    <Form form={form} layout="vertical" initialValues={target ?? { is_active: true, phone_e164: "+86", description: "", address: "", business_hours: "", public_phone: "", logo_asset_id: null, sort_order: null }}>
      <Form.Item name="name" label="商家名称" rules={[{ required: true, whitespace: true, max: 100 }]}><Input maxLength={100} /></Form.Item>
      <Form.Item name="phone_e164" label="核销员手机号" extra="填写 +86 后接手机号。可信绑定该号码的用户自动获得核销身份，号码不公开展示。" rules={[{ required: true, pattern: /^\+[1-9][0-9]{6,14}$/ }]}><Input maxLength={16} /></Form.Item>
      <Form.Item name="logo_asset_id" label="商家 LOGO"><BrandLogoPicker url={logo} onChange={(assetId, url) => { form.setFieldValue("logo_asset_id", assetId); setLogo(url); }} /></Form.Item>
      <Form.Item name="description" label="商家介绍"><RichTextEditor minHeight={100} /></Form.Item>
      <Form.Item name="address" label="消费地址"><Input maxLength={300} /></Form.Item>
      <Form.Item name="business_hours" label="营业时间"><Input maxLength={200} /></Form.Item>
      <Form.Item name="public_phone" label="公开联系电话" extra="此号码会显示给消费者，请确认可以公开。"><Input maxLength={40} /></Form.Item>
      <Space><Form.Item name="sort_order" label="排序"><InputNumber min={0} precision={0} max={2147483647} /></Form.Item><Form.Item name="is_active" label="启用" valuePropName="checked"><Switch /></Form.Item></Space>
    </Form>
  </EditorModal>;
}

export default function MerchantsPage() {
  const admin = useCurrentAdmin(); const client = useQueryClient(); const { message } = App.useApp();
  const allowed = canAccess(admin, "merchants:read"); const write = canAccess(admin, "merchants:update");
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [selected, setSelected] = useState<MerchantRead[]>([]);
  const [edit, setEdit] = useState<{ target: MerchantRead | null }>();
  const query = useQuery({ queryKey: ["local-merchants", page, search], queryFn: () => localCommerceApi.merchants(page, search), enabled: allowed });
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["local-merchants"] }); };
  const status = useMutation({ mutationFn: (active: boolean) => localCommerceApi.merchantStatus({ targets: selected.map(({ id, revision }) => ({ id, revision })), is_active: active }), onSuccess: async () => { setSelected([]); await refresh(); message.success("商家状态已更新"); } });
  return <PageFrame title="商家管理" description="维护线下商家、核销手机号与公开资料。停用后停止新售卖及核销，原订单退款继续处理。">
    {!allowed ? <Alert type="warning" title="无权查看商家" /> : <>
      {status.error && <Alert type="error" title={errorMessage(status.error)} />}
      <ResourceTable title="商家列表" rows={query.data?.items ?? []} loading={query.isLoading} fetching={query.isFetching} error={query.error} retry={query.refetch} page={page} total={query.data?.total} onPage={(value) => { setPage(value); setSelected([]); }}
        selection={write ? { keys: selected.map((row) => row.id), onChange: (_, rows) => setSelected(rows), disabled: status.isPending } : undefined}
        toolbar={[
          <Input.Search key="search" placeholder="商家名称或完整授权手机号" allowClear onSearch={(value) => { setSearch(value.trim()); setPage(1); setSelected([]); }} />,
          write && <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setEdit({ target: null })}>新增商家</Button>,
          write && <Button key="enable" icon={<CheckOutlined />} disabled={!selected.length || status.isPending} onClick={() => status.mutate(true)}>批量启用</Button>,
          write && <Button key="disable" icon={<StopOutlined />} disabled={!selected.length || status.isPending} onClick={() => status.mutate(false)}>批量停用</Button>,
        ]}
        columns={[
          { title: "LOGO", render: (_, row) => row.logo_url ? <Image width={36} height={36} src={row.logo_url} alt={row.name} /> : "未设置" },
          { title: "商家", dataIndex: "name", ellipsis: true },
          { title: "商家 ID", dataIndex: "id", copyable: true, ellipsis: true },
          { title: "核销手机号", dataIndex: "phone_e164" },
          { title: "身份关联", render: (_, row) => row.user_id ? "已关联注册用户" : "等待用户绑定手机号" },
          { title: "状态", render: (_, row) => <Tag color={row.is_active ? "success" : "default"}>{row.is_active ? "启用" : "停用"}</Tag> },
          { title: "地址", dataIndex: "address", ellipsis: true },
          { title: "操作", width: "1%", render: (_, row) => write && <Button icon={<EditOutlined />} onClick={() => setEdit({ target: row })}>编辑</Button> },
        ]} />
    </>}
    {edit && <Editor target={edit.target} close={() => setEdit(undefined)} done={refresh} />}
  </PageFrame>;
}
