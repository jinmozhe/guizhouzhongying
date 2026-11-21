import type { ReceivableRead, SettlementRead, SettlementPayment, SettlementReversal } from "@pinjie/api-client";
import { CheckOutlined, FileDoneOutlined, DownloadOutlined, HistoryOutlined, UndoOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Drawer, Form, Input, InputNumber, Space } from "antd";
import { useRef, useState } from "react";
import { EditorModal } from "@/components/EditorModal";
import { PageFrame } from "@/components/PageFrame";
import { ResourceTable } from "@/components/ResourceTable";
import { StandardConfirmModal } from "@/components/StandardConfirmModal";
import { canAccess, useCurrentAdmin } from "@/features/auth";
import { errorMessage } from "@/lib/api/http";
import { localCommerceApi } from "@/lib/api/local-commerce";

function Payment({ target, close, done }: { target: SettlementRead; close: () => void; done: () => Promise<void> }) {
  const [form] = Form.useForm<{ amount: string; payment_reference: string; paid_at: string }>();
  const submitted = useRef<SettlementPayment | undefined>(undefined);
  return <EditorModal title="登记已完成的线下打款" onClose={close} onSave={async () => {
    if (!submitted.current) {
      const values = await form.validateFields();
      const time = new Date(values.paid_at);
      if (!Number.isFinite(time.getTime())) throw new Error("请输入有效的打款时间");
      submitted.current = { ...values, request_id: globalThis.crypto.randomUUID(), revision: target.revision, paid_at: time.toISOString() };
    }
    await localCommerceApi.paySettlement(target.id, submitted.current);
    await done(); close();
  }}>
    <Alert type="info" title={`商家应收 ¥${target.amount}，不扣手续费和佣金。此操作只登记线下付款事实。`} />
    <Form form={form} layout="vertical" initialValues={{ amount: target.amount }}>
      <Form.Item name="amount" label="实际打款金额" rules={[{ required: true }]}><InputNumber stringMode precision={2} min={0} /></Form.Item>
      <Form.Item name="payment_reference" label="线下付款凭据号" rules={[{ required: true, whitespace: true, max: 100 }]}><Input maxLength={100} /></Form.Item>
      <Form.Item name="paid_at" label="实际打款时间" extra="例如 2026-11-21T14:30:00+08:00" rules={[{ required: true }]}><Input /></Form.Item>
    </Form>
  </EditorModal>;
}

function History({ id, close }: { id: string; close: () => void }) {
  const query = useQuery({ queryKey: ["merchant-settlement-history", id], queryFn: () => localCommerceApi.settlementHistory(id) });
  return <Drawer open title="付款与冲正历史" size={900} onClose={close}><ResourceTable title="付款历史列表" rows={query.data ?? []} loading={query.isLoading} error={query.error} retry={query.refetch} columns={[
    { title: "版本", dataIndex: "revision" }, { title: "事件", render: (_, row) => row.kind === "payment" ? "登记付款" : "冲正登记" },
    { title: "金额", dataIndex: "amount" }, { title: "原付款凭据", dataIndex: "payment_reference" }, { title: "实际付款时间", dataIndex: "paid_at" },
    { title: "纠错原因", dataIndex: "reason" }, { title: "请求号", dataIndex: "request_id" },
  ]} /></Drawer>;
}

function Reversal({ target, close, done }: { target: SettlementRead; close: () => void; done: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const request = useRef<SettlementReversal | undefined>(undefined);
  return <StandardConfirmModal open title="冲正错误付款登记" description={`批次 ${target.id}，金额 ¥${target.amount}。保留原付款历史，将批次恢复为待付款。此操作不退回或再次转出实际资金，请先核实线下凭据。`} loading={false} onCancel={close} onConfirm={async () => {
    if (!request.current) {
      if (!reason.trim()) throw new Error("请填写纠错原因");
      request.current = { request_id: globalThis.crypto.randomUUID(), revision: target.revision, reason: reason.trim() };
    }
    await localCommerceApi.reverseSettlement(target.id, request.current); await done(); close();
  }}><Input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="纠错原因" /></StandardConfirmModal>;
}

function exportBatches(rows: SettlementRead[]) {
  const url = globalThis.URL.createObjectURL(new globalThis.Blob([JSON.stringify(rows, null, 2)], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "merchant-settlements.json"; link.click();
  globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(url), 1000);
}

export default function SettlementsPage() {
  const admin = useCurrentAdmin(); const client = useQueryClient();
  const allowed = canAccess(admin, "merchant-settlements:read"); const write = canAccess(admin, "merchant-settlements:update");
  const [page, setPage] = useState(1); const [batchPage, setBatchPage] = useState(1); const [merchant, setMerchant] = useState("");
  const [selected, setSelected] = useState<ReceivableRead[]>([]); const [payment, setPayment] = useState<SettlementRead>();
  const [selectedBatches, setSelectedBatches] = useState<SettlementRead[]>([]);
  const [history, setHistory] = useState<string>(); const [reversal, setReversal] = useState<SettlementRead>();
  const request = useRef<{ request_id: string; merchant_id: string; receivable_ids: string[] } | undefined>(undefined);
  const query = useQuery({ queryKey: ["merchant-receivables", page, merchant], queryFn: () => localCommerceApi.receivables(page, merchant), enabled: allowed });
  const batches = useQuery({ queryKey: ["merchant-settlements", batchPage, merchant], queryFn: () => localCommerceApi.settlements(batchPage, merchant), enabled: allowed });
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ["merchant-receivables"] }), client.invalidateQueries({ queryKey: ["merchant-settlements"] })]); };
  const create = useMutation({ mutationFn: async () => {
    if (!request.current) {
      const first = selected[0];
      if (!first || selected.some((row) => row.merchant_id !== first.merchant_id || row.settlement_id)) throw new Error("请选择同一商家尚未结算的完整应收条目");
      request.current = { request_id: globalThis.crypto.randomUUID(), merchant_id: first.merchant_id, receivable_ids: selected.map((row) => row.id) };
    }
    return localCommerceApi.createSettlement(request.current);
  }, onSuccess: async () => { request.current = undefined; setSelected([]); await refresh(); } });
  return <PageFrame title="商家应收与结算" description="核销产生含积分全额应收。平台承担积分补贴及佣金，线下打款后登记结清。">
    {!allowed ? <Alert type="warning" title="无权查看商家财务" /> : <>
      <Input.Search placeholder="按商家 ID 筛选，可从商家列表取得" allowClear onSearch={(value) => { if (!request.current) { setMerchant(value.trim()); setPage(1); setBatchPage(1); setSelected([]); setSelectedBatches([]); } }} />
      {create.error && <Alert type="error" title={errorMessage(create.error)} description="结果未知时用原请求重试，系统不会重复组批。" />}
      <ResourceTable title="商家应收列表" rows={query.data?.items ?? []} loading={query.isLoading} fetching={query.isFetching} error={query.error} retry={query.refetch} page={page} total={query.data?.total} onPage={(value) => { if (!request.current) { setPage(value); setSelected([]); } }}
        selection={write ? { keys: selected.map((row) => row.id), onChange: (_, rows) => { if (!request.current) setSelected(rows); }, disabled: create.isPending || !!request.current } : undefined}
        toolbar={[write && <Button key="create" icon={<FileDoneOutlined />} disabled={!selected.length || create.isPending} loading={create.isPending} onClick={() => create.mutate()}>{request.current ? "恢复原对账请求" : "选中应收生成对账批次"}</Button>]}
        columns={[
          { title: "商家 ID", dataIndex: "merchant_id", ellipsis: true }, { title: "订单", dataIndex: "order_id", ellipsis: true },
          { title: "商家应收", dataIndex: "gross_amount", render: (value) => `¥${value}` },
          { title: "微信实付", dataIndex: "cash_amount", render: (value) => `¥${value}` },
          { title: "平台积分补贴", dataIndex: "points_amount", render: (value) => `¥${value}` },
          { title: "结算批次", render: (_, row) => row.settlement_id ?? "未组批" },
        ]} />
      <ResourceTable title="结算批次列表" rows={batches.data?.items ?? []} loading={batches.isLoading} fetching={batches.isFetching} error={batches.error} retry={batches.refetch} page={batchPage} total={batches.data?.total} onPage={(value) => { setBatchPage(value); setSelectedBatches([]); }}
        selection={write ? { keys: selectedBatches.map((row) => row.id), onChange: (_, rows) => setSelectedBatches(rows) } : undefined}
        toolbar={[write && <Button key="export" icon={<DownloadOutlined />} disabled={!selectedBatches.length} onClick={() => { exportBatches(selectedBatches); setSelectedBatches([]); }}>导出所选批次</Button>]}
        columns={[
          { title: "批次", dataIndex: "id", ellipsis: true }, { title: "商家", dataIndex: "merchant_id", ellipsis: true },
          { title: "应付", dataIndex: "amount", render: (value) => `¥${value}` },
          { title: "状态", render: (_, row) => row.status === "paid" ? "已线下结清" : "待线下打款" },
          { title: "付款凭据", dataIndex: "payment_reference" },
          { title: "操作", width: "1%", render: (_, row) => <Space><Button icon={<HistoryOutlined />} onClick={() => setHistory(row.id)}>历史</Button>{write && (row.status === "open" ? <Button icon={<CheckOutlined />} onClick={() => setPayment(row)}>登记全额打款</Button> : <Button icon={<UndoOutlined />} onClick={() => setReversal(row)}>纠错冲正</Button>)}</Space> },
        ]} />
    </>}
    {payment && <Payment target={payment} close={() => setPayment(undefined)} done={refresh} />}
    {history && <History id={history} close={() => setHistory(undefined)} />}
    {reversal && <Reversal target={reversal} close={() => setReversal(undefined)} done={refresh} />}
  </PageFrame>;
}
