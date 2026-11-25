import type { AssetRead, MerchantAlbumImageRead } from "@pinjie/api-client";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Empty,
  Flex,
  Image,
  Input,
  Modal,
  Pagination,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  theme,
} from "antd";
import { useEffect, useRef, useState } from "react";

import { StandardConfirmModal } from "@/components/StandardConfirmModal";
import { canAccess, useCurrentAdmin } from "@/features/auth";
import { adminApi } from "@/lib/api/admin";
import { errorMessage } from "@/lib/api/http";
import {
  MERCHANT_ALBUM_MAX_COUNT,
  MERCHANT_ALBUM_MAX_FILE_BYTES,
  assetToAlbumImage,
  validateMerchantAlbum,
} from "./merchant-album-policy";

type Entry =
  | { key: string; status: "ready"; image: MerchantAlbumImageRead }
  | { key: string; status: "queued" | "uploading" | "error"; file: globalThis.File; error?: string };

export type AlbumGalleryState = { uploading: boolean; unresolved: boolean };

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_UPLOADERS = new Set(["admin", "system"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function AlbumAssetPickerModal({
  open,
  existingImages,
  currentCount,
  onClose,
  onConfirm,
}: {
  open: boolean;
  existingImages: MerchantAlbumImageRead[];
  currentCount: number;
  onClose: () => void;
  onConfirm: (assets: AssetRead[]) => void;
}) {
  const { token } = theme.useToken();
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<AssetRead[]>([]);
  const [notice, setNotice] = useState<string>();

  const query = useQuery({
    queryKey: ["merchant-album-assets", page, search],
    queryFn: () => adminApi.assets({ page, search: search || undefined, scene: "product" }),
    enabled: open,
  });

  const eligible = (query.data?.items ?? []).filter(
    (asset) => ALLOWED_UPLOADERS.has(asset.uploader_type) && ALLOWED_MIMES.has(asset.mime_type),
  );
  const pickedIds = new Set(picked.map((item) => item.id));

  const checkCandidates = (nextPicked: AssetRead[]): string | undefined => {
    if (currentCount + nextPicked.length > MERCHANT_ALBUM_MAX_COUNT) {
      return `商家相册最多支持 ${MERCHANT_ALBUM_MAX_COUNT} 张图片`;
    }
    return validateMerchantAlbum([...existingImages, ...nextPicked.map(assetToAlbumImage)]);
  };

  const toggleAsset = (asset: AssetRead) => {
    if (pickedIds.has(asset.id)) {
      setPicked(picked.filter((item) => item.id !== asset.id));
      setNotice(undefined);
      return;
    }
    const next = [...picked, asset];
    const reason = checkCandidates(next);
    if (reason) {
      setNotice(reason);
      return;
    }
    setPicked(next);
    setNotice(undefined);
  };

  const handleClose = () => {
    setPicked([]);
    setNotice(undefined);
    onClose();
  };

  const handleConfirm = () => {
    const reason = checkCandidates(picked);
    if (reason) {
      setNotice(reason);
      return;
    }
    onConfirm(picked);
    setPicked([]);
    setNotice(undefined);
    onClose();
  };

  const runSearch = () => {
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const resetSearch = () => {
    setSearchDraft("");
    setSearch("");
    setPage(1);
  };

  return (
    <Modal
      open={open}
      title="从素材库选择相册图片"
      width={780}
      destroyOnHidden
      onCancel={handleClose}
      footer={
        <Flex justify="space-between" align="center" style={{ width: "100%" }}>
          <Pagination
            size="small"
            current={page}
            pageSize={20}
            total={query.data?.total ?? 0}
            showSizeChanger={false}
            onChange={(nextPage) => setPage(nextPage)}
          />
          <Flex gap={8}>
            <Button onClick={handleClose}>取消</Button>
            <Button type="primary" disabled={!picked.length} onClick={handleConfirm}>
              加入所选（{picked.length}）
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Flex vertical gap={12} style={{ marginBlock: 12 }}>
        <Flex gap={8} align="center" wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="按文件名搜索已有素材"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onPressEnter={runSearch}
            style={{ maxWidth: 300 }}
          />
          <Button type="primary" onClick={runSearch}>搜索</Button>
          <Button icon={<ReloadOutlined />} onClick={resetSearch}>重置</Button>
          {picked.length > 0 && (
            <Typography.Text type="secondary">已勾选 {picked.length} 张</Typography.Text>
          )}
        </Flex>
        {notice && <Alert showIcon type="warning" title={notice} />}
        {query.isError && <Alert showIcon type="error" title={errorMessage(query.error)} />}
        <Spin spinning={query.isLoading || query.isFetching}>
          <div style={{ minHeight: 320, maxHeight: 440, overflowY: "auto", padding: 4 }}>
            {!eligible.length && !query.isLoading ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可选静态图片素材" style={{ marginBlock: 60 }} />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                {eligible.map((asset) => {
                  const selected = pickedIds.has(asset.id);
                  const reason = selected ? undefined : checkCandidates([...picked, asset]);
                  const disabled = !selected && Boolean(reason);
                  return (
                    <div
                      key={asset.id}
                      role="button"
                      tabIndex={disabled ? -1 : 0}
                      aria-disabled={disabled}
                      onClick={() => { if (!disabled || selected) toggleAsset(asset); }}
                      onKeyDown={(event) => {
                        if ((event.key === "Enter" || event.key === " ") && (!disabled || selected)) {
                          event.preventDefault();
                          toggleAsset(asset);
                        }
                      }}
                      style={{
                        position: "relative",
                        border: `2px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
                        borderRadius: token.borderRadiusLG,
                        padding: 6,
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.55 : 1,
                        backgroundColor: selected ? token.colorPrimaryBg : token.colorBgContainer,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                      }}
                    >
                      {selected && (
                        <CheckCircleFilled
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            fontSize: 16,
                            color: token.colorPrimary,
                            backgroundColor: token.colorBgContainer,
                            borderRadius: "50%",
                            zIndex: 1,
                          }}
                        />
                      )}
                      <div
                        style={{
                          width: "100%",
                          height: 88,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          backgroundColor: token.colorFillQuaternary,
                          borderRadius: token.borderRadiusSM,
                        }}
                      >
                        <Image
                          src={asset.url}
                          alt={asset.original_name}
                          preview={false}
                          style={{ maxHeight: 88, maxWidth: "100%", objectFit: "contain" }}
                        />
                      </div>
                      <div style={{ width: "100%", marginTop: 6, textAlign: "center" }}>
                        <Typography.Text ellipsis={{ tooltip: asset.original_name }} style={{ fontSize: 12, display: "block" }}>
                          {asset.original_name}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 11, display: "block" }}>
                          {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : "尺寸未核验 · "}
                          {formatBytes(asset.file_size)}
                        </Typography.Text>
                        {reason && (
                          <Typography.Text type="danger" ellipsis={{ tooltip: reason }} style={{ fontSize: 11, display: "block" }}>
                            {reason}
                          </Typography.Text>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Spin>
      </Flex>
    </Modal>
  );
}

/** 商家相册管理组件：支持多图串行上传队列、素材库多选、任意排序与移除二次确认。 */
export function MerchantAlbumGallery({
  initialImages,
  onChange,
  onStateChange,
}: {
  initialImages: MerchantAlbumImageRead[];
  onChange: (images: MerchantAlbumImageRead[]) => void;
  onStateChange: (state: AlbumGalleryState) => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const admin = useCurrentAdmin();
  const client = useQueryClient();
  const canBrowseAssets = canAccess(admin, "assets:read");

  const [entries, setEntries] = useState<Entry[]>(() =>
    initialImages.map((image) => ({ key: `asset:${image.asset_id}`, status: "ready", image })),
  );
  const current = useRef(entries);
  const callbacks = useRef({ onChange, onStateChange });
  callbacks.current = { onChange, onStateChange };
  const alive = useRef(true);
  const running = useRef(false);
  const serial = useRef(0);

  const [selected, setSelected] = useState<string[]>([]);
  const [removal, setRemoval] = useState<string[]>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const readyImages = (items: Entry[]) => items.flatMap((entry) => (entry.status === "ready" ? [entry.image] : []));
  const busy = entries.some((entry) => entry.status === "queued" || entry.status === "uploading");

  const publish = (items: Entry[]) => {
    if (!alive.current) return;
    current.current = items;
    setEntries(items);
    callbacks.current.onChange(readyImages(items));
    callbacks.current.onStateChange({
      uploading: items.some((entry) => entry.status === "queued" || entry.status === "uploading"),
      unresolved: items.some((entry) => entry.status !== "ready"),
    });
  };

  const pump = async () => {
    if (running.current || !alive.current) return;
    running.current = true;
    try {
      for (;;) {
        const entry = current.current.find((item) => item.status === "queued");
        if (!entry || entry.status !== "queued" || !alive.current) break;
        publish(current.current.map((item) => (item.key === entry.key ? { ...entry, status: "uploading" } : item)));
        try {
          const asset = await adminApi.uploadAsset(entry.file, "product");
          if (!alive.current) break;
          const image = assetToAlbumImage(asset);
          const error = validateMerchantAlbum([...readyImages(current.current), image]);
          if (error) throw new Error(error);
          publish(
            current.current.map((item) => (item.key === entry.key ? { key: entry.key, status: "ready", image } : item)),
          );
          void client.invalidateQueries({ queryKey: ["merchant-album-assets"] }, { throwOnError: true }).catch(() => {
            if (alive.current) setNotice("图片已上传，素材库刷新失败，请稍后重试查询");
          });
        } catch (error) {
          if (!alive.current) break;
          publish(
            current.current.map((item) =>
              item.key === entry.key ? { ...entry, status: "error", error: errorMessage(error) } : item,
            ),
          );
        }
      }
    } finally {
      running.current = false;
    }
  };

  const enqueue = (file: globalThis.File) => {
    if (current.current.length >= MERCHANT_ALBUM_MAX_COUNT) {
      setNotice(`商家相册最多支持 ${MERCHANT_ALBUM_MAX_COUNT} 张，请先移除多余图片`);
      return Upload.LIST_IGNORE;
    }
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setNotice("仅支持 JPG、PNG、WebP 格式静态图片");
      return Upload.LIST_IGNORE;
    }
    if (file.size > MERCHANT_ALBUM_MAX_FILE_BYTES) {
      setNotice("商家相册单张图片不能超过 5 MiB");
      return Upload.LIST_IGNORE;
    }
    setNotice(undefined);
    serial.current += 1;
    publish([...current.current, { key: `upload:${serial.current}`, status: "queued", file }]);
    void pump();
    return Upload.LIST_IGNORE;
  };

  const appendAssets = (assets: AssetRead[]) => {
    const images = assets.map(assetToAlbumImage);
    if (current.current.length + images.length > MERCHANT_ALBUM_MAX_COUNT) {
      setNotice(`商家相册最多支持 ${MERCHANT_ALBUM_MAX_COUNT} 张图片`);
      return;
    }
    const error = validateMerchantAlbum([...readyImages(current.current), ...images]);
    if (error) {
      setNotice(error);
      return;
    }
    publish([
      ...current.current,
      ...images.map((image): Entry => ({ key: `asset:${image.asset_id}`, status: "ready", image })),
    ]);
    setNotice(undefined);
    message.success(`已加入 ${images.length} 张素材到商家相册`);
  };

  const move = (key: string, destination: number) => {
    if (busy) return;
    const items = [...current.current];
    const index = items.findIndex((item) => item.key === key);
    const entry = items[index];
    if (!entry || destination < 0 || destination >= items.length) return;
    items.splice(index, 1);
    items.splice(destination, 0, entry);
    publish(items);
  };

  const currentReady = readyImages(entries);
  const totalBytes = currentReady.reduce((sum, image) => sum + image.file_size, 0);

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%", minWidth: 0 }}>
      <Flex wrap gap={8} align="center">
        <Upload
          accept=".jpg,.jpeg,.png,.webp"
          multiple
          fileList={[]}
          beforeUpload={enqueue}
          disabled={entries.length >= MERCHANT_ALBUM_MAX_COUNT || busy}
        >
          <Button type="primary" icon={<UploadOutlined />} loading={busy}>
            上传相册图片
          </Button>
        </Upload>
        {canBrowseAssets && (
          <Button
            icon={<FolderOpenOutlined />}
            disabled={entries.length >= MERCHANT_ALBUM_MAX_COUNT || busy}
            onClick={() => setPickerOpen(true)}
          >
            从素材库选择
          </Button>
        )}
        <Button danger icon={<DeleteOutlined />} disabled={!selected.length || busy} onClick={() => setRemoval([...selected])}>
          移除所选
        </Button>
        <Typography.Text type="secondary">
          {entries.length}/{MERCHANT_ALBUM_MAX_COUNT} 张 · {(totalBytes / 1024 / 1024).toFixed(2)} / 50 MiB
        </Typography.Text>
      </Flex>

      <Typography.Text type="secondary">
        支持门店实景、店内环境、营业执照与资质证书等静态图片（JPG、PNG、WebP），最多 20 张，单图不超过 5 MiB，整组不超过 50 MiB。调整完成后点击底部“保存”统一生效。
      </Typography.Text>

      {!canBrowseAssets && (
        <Alert type="info" showIcon title="没有资产查询权限，仍可直接上传新图片；已绑定相册图片会保留。" />
      )}
      {notice && <Alert showIcon type="warning" title={notice} />}
      {entries.some((entry) => entry.status === "error") && (
        <Alert showIcon type="error" title="部分图片上传未完成，请重试或移除失败项后再保存" />
      )}

      {!entries.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无商家相册图片" />
      ) : (
        <Image.PreviewGroup>
          <Flex vertical gap={8}>
            {entries.map((entry, index) => (
              <Flex
                key={entry.key}
                gap={12}
                wrap
                align="center"
                style={{
                  padding: token.paddingSM,
                  border: `${token.lineWidth}px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadius,
                }}
              >
                <Checkbox
                  aria-label={`选择商家相册第${index + 1}张`}
                  checked={selected.includes(entry.key)}
                  disabled={busy}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, entry.key]
                        : selected.filter((key) => key !== entry.key),
                    )
                  }
                />
                <Tag>{index + 1}</Tag>
                {entry.status === "ready" && (
                  <Image
                    src={entry.image.url}
                    alt={entry.image.original_name}
                    width={64}
                    height={64}
                    style={{ objectFit: "cover", borderRadius: token.borderRadiusSM }}
                  />
                )}
                <div style={{ flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>
                  <Typography.Text>
                    {entry.status === "ready" ? entry.image.original_name : entry.file.name}
                  </Typography.Text>
                  <div>
                    <Typography.Text type={entry.status === "error" ? "danger" : "secondary"}>
                      {entry.status === "ready"
                        ? `${entry.image.width && entry.image.height ? `${entry.image.width} × ${entry.image.height}` : "尺寸待回填"} · ${formatBytes(entry.image.file_size)}`
                        : entry.status === "error"
                          ? entry.error
                          : entry.status === "queued"
                            ? "等待上传"
                            : "正在上传"}
                    </Typography.Text>
                  </div>
                </div>
                <Space wrap size={4}>
                  {entry.status === "error" && (
                    <Button
                      icon={<ReloadOutlined />}
                      disabled={busy}
                      onClick={() => {
                        publish(
                          current.current.map((item) =>
                            item.key === entry.key ? { ...entry, status: "queued", error: undefined } : item,
                          ),
                        );
                        void pump();
                      }}
                    >
                      重试
                    </Button>
                  )}
                  <Button
                    icon={<ArrowUpOutlined />}
                    aria-label={`上移商家相册第${index + 1}张`}
                    disabled={busy || index === 0}
                    onClick={() => move(entry.key, index - 1)}
                  />
                  <Button
                    icon={<ArrowDownOutlined />}
                    aria-label={`下移商家相册第${index + 1}张`}
                    disabled={busy || index === entries.length - 1}
                    onClick={() => move(entry.key, index + 1)}
                  />
                  <Button
                    icon={<VerticalAlignTopOutlined />}
                    aria-label={`置顶商家相册第${index + 1}张`}
                    disabled={busy || index === 0}
                    onClick={() => move(entry.key, 0)}
                  />
                  <Button
                    icon={<VerticalAlignBottomOutlined />}
                    aria-label={`置底商家相册第${index + 1}张`}
                    disabled={busy || index === entries.length - 1}
                    onClick={() => move(entry.key, entries.length - 1)}
                  />
                  <Button danger icon={<DeleteOutlined />} disabled={busy} onClick={() => setRemoval([entry.key])}>
                    移除
                  </Button>
                </Space>
              </Flex>
            ))}
          </Flex>
        </Image.PreviewGroup>
      )}

      {canBrowseAssets && (
        <AlbumAssetPickerModal
          open={pickerOpen}
          existingImages={currentReady}
          currentCount={entries.length}
          onClose={() => setPickerOpen(false)}
          onConfirm={appendAssets}
        />
      )}

      <StandardConfirmModal
        open={Boolean(removal)}
        title="移除商家相册图片"
        loading={false}
        description={`移除选中的 ${removal?.length ?? 0} 张图片，保存商家后解除关联；已上传文件仍保留在资产库。取消将保留当前草稿。`}
        onCancel={() => setRemoval(undefined)}
        onConfirm={async () => {
          if (busy) throw new Error("上传进行中，请稍后操作");
          const keys = new Set(removal ?? []);
          publish(current.current.filter((entry) => !keys.has(entry.key)));
          setSelected(selected.filter((key) => !keys.has(key)));
          setRemoval(undefined);
          message.success("已从草稿移除，保存商家后生效");
        }}
      />
    </Space>
  );
}
