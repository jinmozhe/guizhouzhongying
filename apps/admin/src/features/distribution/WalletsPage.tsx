import { EyeOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useState } from "react";

import { CommerceList } from "@/components/CommerceList";
import { PageFrame } from "@/components/PageFrame";
import { WalletLedgerDrawer, type WalletLedgerUser, type WalletTrackType } from "@/components/WalletLedgerDrawer";
import { commerceApi } from "@/lib/api/commerce";

export default function WalletsPage() {
  const [detail, setDetail] = useState<{ user: WalletLedgerUser; walletType: WalletTrackType } | null>(null);

  return (
    <PageFrame title="双轨钱包" description="佣金与消费钱包独立记账，不提供人工改余额、互转或伪造打款。">
      <CommerceList
        resource="wallets"
        title="钱包"
        load={commerceApi.wallets}
        fields={[
          { name: "record_id", label: "钱包号" },
          { name: "user_id", label: "会员用户号" },
          {
            name: "wallet_type",
            label: "轨道",
            options: [
              { label: "佣金钱包", value: "commission" },
              { label: "消费钱包", value: "consumption" },
            ],
          },
        ]}
        columns={[
          { title: "钱包号", dataIndex: "id", ellipsis: true },
          { title: "会员用户号", dataIndex: "user_id", ellipsis: true },
          { title: "轨道", render: (_, row) => (row.wallet_type === "commission" ? "佣金钱包" : "消费钱包") },
          { title: "可用金额", dataIndex: "available_amount" },
          { title: "冻结金额", dataIndex: "frozen_amount" },
          { title: "欠款", dataIndex: "debt_amount" },
          { title: "更新时间", dataIndex: "updated_at" },
          {
            title: "操作",
            width: "1%",
            render: (_, row) => (
              <Button
                icon={<EyeOutlined />}
                onClick={() =>
                  setDetail({
                    user: { user_id: row.user_id },
                    walletType: row.wallet_type === "consumption" ? "consumption" : "commission",
                  })
                }
              >
                查看流水
              </Button>
            ),
          },
        ]}
      />

      <WalletLedgerDrawer
        open={Boolean(detail)}
        user={detail?.user ?? null}
        initialWalletType={detail?.walletType ?? "commission"}
        onClose={() => setDetail(null)}
      />
    </PageFrame>
  );
}
