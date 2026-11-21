import { useInfiniteQuery } from "@tanstack/react-query";
import { Alert, Form, Select } from "antd";
import { useState } from "react";
import { localCommerceApi } from "@/lib/api/local-commerce";
import { errorMessage } from "@/lib/api/http";

export function MerchantField({ required = true }: { required?: boolean }) {
  const [search, setSearch] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["local-merchants-options", search], initialPageParam: 1,
    queryFn: ({ pageParam }) => localCommerceApi.merchants(pageParam, search),
    getNextPageParam: (page) => page.page < page.total_pages ? page.page + 1 : undefined,
  });
  return <>
    {query.error && <Alert type="error" title={errorMessage(query.error)} action={<a onClick={() => void query.refetch()}>重试</a>} />}
    <Form.Item name="merchant_id" label="到店消费商家" extra="选择商家后按到店消费销售；历史商品保留未关联状态时不能新下单。需要商家查看权限。" rules={[{ required, message: "请选择消费商家" }]}>
      <Select showSearch={{ filterOption: false, onSearch: setSearch }} loading={query.isFetching}
        options={(query.data?.pages.flatMap((page) => page.items) ?? []).map((row) => ({ value: row.id, label: row.name + (row.is_active ? "" : "（已停用）"), disabled: !row.is_active }))}
        onPopupScroll={(event) => { const target = event.currentTarget; if (target.scrollHeight - target.scrollTop - target.clientHeight < 50 && query.hasNextPage && !query.isFetching) void query.fetchNextPage(); }} />
    </Form.Item>
  </>;
}
