import type { AdminRead, AssetRead, MerchantAlbumImageRead } from "@pinjie/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { AdminContext } from "@/features/auth";
import { server } from "@/test/setup";
import { MerchantAlbumGallery } from "./MerchantAlbumGallery";

const admin: AdminRead = {
  id: "01900000-0000-7000-8000-000000000001",
  username: "merchant-admin",
  display_name: "商家管理员",
  is_active: true,
  is_superuser: false,
  roles: [],
  permissions: [],
  created_at: "2026-11-25T00:00:00Z",
  updated_at: "2026-11-25T00:00:00Z",
};

const picture = (id: string, name: string, fileSize = 2048): MerchantAlbumImageRead => ({
  asset_id: id,
  original_name: name,
  url: `/static/uploads/product/${name}`,
  file_size: fileSize,
  width: 1200,
  height: 900,
  frame_count: 1,
});

function mount(initialImages: MerchantAlbumImageRead[] = [], permissions: string[] = []) {
  const onChange = vi.fn();
  const onStateChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <ConfigProvider locale={zhCN}>
      <App>
        <QueryClientProvider client={client}>
          <AdminContext.Provider value={{ ...admin, permissions }}>
            <MerchantAlbumGallery
              initialImages={initialImages}
              onChange={onChange}
              onStateChange={onStateChange}
            />
          </AdminContext.Provider>
        </QueryClientProvider>
      </App>
    </ConfigProvider>,
  );
  return { ...result, onChange, onStateChange };
}

function asset(id: string, name: string, fileSize = 2048): AssetRead {
  return {
    id,
    uploader_type: "admin",
    uploader_id: admin.id,
    storage_driver: "local",
    scene: "product",
    mime_type: "image/jpeg",
    file_key: `product/${name}`,
    file_hash: "a".repeat(64),
    created_at: admin.created_at,
    updated_at: admin.updated_at,
    ...picture(id, name, fileSize),
  };
}

describe("MerchantAlbumGallery", () => {
  it("keeps metadata without asset-list permission, reorders items, and confirms bulk removal", async () => {
    const user = userEvent.setup();
    const first = picture("first", "storefront.jpg");
    const second = picture("second", "license.jpg");
    const view = mount([first, second]);

    expect(screen.getByText("storefront.jpg")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "从素材库选择" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上移商家相册第2张" }));
    expect(view.onChange).toHaveBeenLastCalledWith([second, first]);

    await user.click(screen.getByRole("checkbox", { name: "选择商家相册第1张" }));
    await user.click(screen.getByRole("button", { name: "移除所选" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(view.onChange).toHaveBeenLastCalledWith([second, first]);

    await user.click(screen.getByRole("button", { name: "移除所选" }));
    await user.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(view.onChange).toHaveBeenLastCalledWith([first]));
  });

  it("retains failed upload position and restores order after retry", async () => {
    const calls: string[] = [];
    server.use(
      http.post("*/api/v1/assets/upload", async ({ request }) => {
        const body = await request.formData();
        const file = body.get("file") as globalThis.File;
        calls.push(file.name);
        if (file.name === "first.jpg" && calls.filter((name) => name === file.name).length === 1) {
          return HttpResponse.json({ code: "ASSET_STORAGE_FAILED", message: "上传暂时失败" }, { status: 503 });
        }
        return HttpResponse.json({ code: "OK", message: "ok", data: asset(file.name, file.name) });
      }),
    );

    const user = userEvent.setup();
    const view = mount();
    const input = view.container.querySelector<globalThis.HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, [
      new globalThis.File(["a"], "first.jpg", { type: "image/jpeg" }),
      new globalThis.File(["b"], "second.jpg", { type: "image/jpeg" }),
    ]);

    await waitFor(() => expect(view.onStateChange).toHaveBeenLastCalledWith({ uploading: false, unresolved: true }));
    expect(calls).toEqual(["first.jpg", "second.jpg"]);

    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(view.onStateChange).toHaveBeenLastCalledWith({ uploading: false, unresolved: false }));
    expect(view.onChange.mock.lastCall?.[0].map((image: MerchantAlbumImageRead) => image.original_name)).toEqual([
      "first.jpg",
      "second.jpg",
    ]);
  });

  it("rejects duplicate uploaded asset and keeps unresolved state", async () => {
    const existing = picture("same", "existing.jpg");
    server.use(
      http.post("*/api/v1/assets/upload", () =>
        HttpResponse.json({ code: "OK", message: "ok", data: asset("same", "duplicate.jpg") }),
      ),
    );

    const user = userEvent.setup();
    const view = mount([existing]);
    await user.upload(
      view.container.querySelector<globalThis.HTMLInputElement>('input[type="file"]')!,
      new globalThis.File(["a"], "duplicate.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() => expect(view.onStateChange).toHaveBeenLastCalledWith({ uploading: false, unresolved: true }));
    expect(view.onChange).toHaveBeenLastCalledWith([existing]);
    expect(screen.getByText("该图片已在相册中，请勿重复选择")).toBeInTheDocument();
  });
});
