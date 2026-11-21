import type { OperatorInput, OperatorRead } from "@pinjie/api-client";
import { CheckOutlined, EditOutlined, PlusOutlined, SearchOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Switch } from "antd";
import { useState } from "react";
import { EditorModal } from "@/components/EditorModal";
import { PageFrame } from "@/components/PageFrame";
import { ResourceTable } from "@/components/ResourceTable";
import { canAccess, useCurrentAdmin } from "@/features/auth";
import { errorMessage } from "@/lib/api/http";
import { localCommerceApi } from "@/lib/api/local-commerce";

function Editor({ target, close, done }: { target: OperatorRead | null; close: () => void; done: () => Promise<void> }) {
  const [form] = Form.useForm<OperatorInput>();
  const lookup = useMutation({ mutationFn: async () => { const { phone_e164 } = await form.validateFields(["phone_e164"]); return localCommerceApi.lookup(phone_e164); } });
  return <EditorModal title={target ? "编辑物业授权" : "新增物业授权"} onClose={close} onSave={async () => {
    const values = await form.validateFields();
    if (target) await localCommerceApi.updateOperator(target.id, { ...values, revision: target.revision });
    else await localCommerceApi.createOperator(values);
    await done(); close();
  }}>
    <Form form={form} layout="vertical" initialValues={target ?? { name: "", phone_e164: "+86", is_active: true }} onValuesChange={() => lookup.reset()}>
      <Form.Item name="name" label="物业名称" rules={[{ required: true, whitespace: true, max: 100 }]}><Input maxLength={100} /></Form.Item>
      <Form.Item name="phone_e164" label="授权手机号" extra="可预录尚未注册的号码，也可查询已有用户。保存后自动绑定可信号码匹配的用户。" rules={[{ required: true, pattern: /^\+[1-9][0-9]{6,14}$/ }]}><Input maxLength={16} /></Form.Item>
      <Button icon={<SearchOutlined />} loading={lookup.isPending} onClick={() => lookup.mutate()}>按手机号查询已注册用户</Button>
      {lookup.data && <Alert type="success" title={`${lookup.data.display_name ?? "会员"} · ${lookup.data.phone_masked}`} description={`保存后关联用户 ${lookup.data.id}`} />}
      {lookup.error && <Alert type="warning" title={errorMessage(lookup.error)} />}
      <Form.Item name="is_active" label="启用授权" valuePropName="checked"><Switch /></Form.Item>
    </Form>
  </EditorModal>;
}

export default function PropertyOperatorsPage() {
  const admin = useCurrentAdmin(); const client = useQueryClient();
  const allowed = canAccess(admin, "property-operators:read"); const write = canAccess(admin, "property-operators:update");
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [selected, setSelected] = useState<OperatorRead[]>([]);
  const [edit, setEdit] = useState<{ target: OperatorRead | null }>();
  const query = useQuery({ queryKey: ["property-operators", page, search], queryFn: () => localCommerceApi.operators(page, search), enabled: allowed });
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["property-operators"] }); };
  const status = useMutation({ mutationFn: (active: boolean) => localCommerceApi.operatorStatus({ targets: selected.map(({ id, revision }) => ({ id, revision })), is_active: active }), onSuccess: async () => { setSelected([]); await refresh(); } });
  return <PageFrame title="物业授权" description="物业仅可向有效已注册用户发放积分，不设业务额度。发放积分不参与会员升级。">
    {!allowed ? <Alert type="warning" title="无权查看物业授权" /> : <>
      {status.error && <Alert type="error" title={errorMessage(status.error)} />}
      <ResourceTable title="物业授权列表" rows={query.data?.items ?? []} loading={query.isLoading} fetching={query.isFetching} error={query.error} retry={query.refetch} page={page} total={query.data?.total} onPage={(value) => { setPage(value); setSelected([]); }}
        selection={write ? { keys: selected.map((row) => row.id), onChange: (_, rows) => setSelected(rows), disabled: status.isPending } : undefined}
        toolbar={[
          <Input.Search key="search" placeholder="名称或完整授权手机号" onSearch={(value) => { setSearch(value.trim()); setPage(1); setSelected([]); }} allowClear />,
          write && <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setEdit({ target: null })}>新增授权</Button>,
          write && <Button key="enable" icon={<CheckOutlined />} disabled={!selected.length || status.isPending} onClick={() => status.mutate(true)}>批量启用</Button>,
          write && <Button key="disable" icon={<StopOutlined />} disabled={!selected.length || status.isPending} onClick={() => status.mutate(false)}>批量停用</Button>,
        ]}
        columns={[
          { title: "名称", dataIndex: "name" }, { title: "手机号", dataIndex: "phone_e164" },
          { title: "绑定用户", render: (_, row) => row.user_id ?? "等待注册绑定" },
          { title: "状态", render: (_, row) => row.is_active ? "启用" : "停用" },
          { title: "操作", width: "1%", render: (_, row) => write && <Button icon={<EditOutlined />} onClick={() => setEdit({ target: row })}>编辑</Button> },
        ]} />
    </>}
    {edit && <Editor target={edit.target} close={() => setEdit(undefined)} done={refresh} />}
  </PageFrame>;
}
