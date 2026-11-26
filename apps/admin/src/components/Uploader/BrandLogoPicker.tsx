import type { AssetRead } from "@pinjie/api-client";
import {
  DeleteOutlined,
  FolderOpenOutlined,
  PictureOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Flex, Image, Modal, Radio, Space, Typography, Upload, theme } from "antd";
import type { UploadProps } from "antd";
import { useEffect, useRef, useState } from "react";

import { StandardConfirmModal } from "@/components/StandardConfirmModal";
import { adminApi } from "@/lib/api/admin";
import { errorMessage } from "@/lib/api/http";
import {
  adaptImageForSquareUpload,
  isNearSquare,
  readImageDimensions,
  type SquareAdaptMode,
} from "@/lib/logo-square-adapt";
import { AssetSelectModal } from "./AssetSelectModal";

export type BrandLogoPickerProps = {
  value?: string | null;
  url?: string | null;
  onChange?: (assetId: string | null, url: string | null) => void;
  disabled?: boolean;
  maxSizeMb?: number;
  entityLabel?: string;
};

type PendingAdaptState = {
  file: globalThis.File;
  width: number;
  height: number;
  previewUrl: string;
};

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TRANSPARENT_CHECKERBOARD =
  "repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%) 50% / 12px 12px";

const ADAPT_MODE_OPTIONS: Array<{
  value: SquareAdaptMode;
  title: string;
  description: string;
}> = [
  {
    value: "contain_transparent",
    title: "完整适配 1:1（透明底，推荐）",
    description: "等比完整居中放入透明正方形画布，不裁切文字与图形",
  },
  {
    value: "contain_white",
    title: "完整适配 1:1（白底）",
    description: "等比完整居中并填充纯白背景，适合白底招牌类 LOGO",
  },
  {
    value: "cover_crop",
    title: "居中裁剪为 1:1",
    description: "自动截取正中心正方形区域，适合照片或满版图形",
  },
  {
    value: "original",
    title: "保留原比例上传",
    description: "不修改宽高比，直接由服务端等比压缩至 ≤ 400px",
  },
];

export function BrandLogoPicker({
  value,
  url,
  onChange,
  disabled = false,
  maxSizeMb = 20,
  entityLabel = "LOGO",
}: BrandLogoPickerProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();

  const [uploading, setUploading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [error, setError] = useState<string>();
  const [pendingAdapt, setPendingAdapt] = useState<PendingAdaptState | null>(null);
  const [adaptMode, setAdaptMode] = useState<SquareAdaptMode>("contain_transparent");
  const [adaptError, setAdaptError] = useState<string>();

  // 同步防重锁，避免并发选择或重复点击提交产生竞态。
  const busyRef = useRef(false);

  // 释放待适配预览的对象 URL，避免关闭弹窗或卸载组件时产生内存泄漏。
  useEffect(() => {
    const objectUrl = pendingAdapt?.previewUrl;
    return () => {
      if (objectUrl) {
        globalThis.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [pendingAdapt?.previewUrl]);

  const uploadFile = async (file: globalThis.File, successText: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setUploading(true);
    setError(undefined);
    try {
      const asset = await adminApi.uploadAsset(file, "product", "logo_icon");
      onChange?.(asset.id, asset.url);
      message.success(successText);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      busyRef.current = false;
      setUploading(false);
    }
  };

  const handleFileSelected = async (file: globalThis.File) => {
    if (disabled || busyRef.current || pendingAdapt) {
      return;
    }
    if (!IMAGE_TYPES.has(file.type)) {
      setError("仅支持 JPG、PNG 或 WebP 格式图片");
      return;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`图片原图大小不能超过 ${maxSizeMb} MB`);
      return;
    }
    setError(undefined);

    const dimensions = await readImageDimensions(file);
    if (dimensions && !isNearSquare(dimensions.width, dimensions.height)) {
      const previewUrl = globalThis.URL.createObjectURL(file);
      setAdaptMode("contain_transparent");
      setAdaptError(undefined);
      setPendingAdapt({
        file,
        width: dimensions.width,
        height: dimensions.height,
        previewUrl,
      });
      return;
    }

    await uploadFile(file, `${entityLabel}上传成功，已自动压缩优化为 WebP`);
  };

  const beforeUpload: UploadProps["beforeUpload"] = (file) => {
    void handleFileSelected(file as globalThis.File);
    return Upload.LIST_IGNORE;
  };

  const handleConfirmAdapt = async () => {
    if (!pendingAdapt || busyRef.current) return;
    busyRef.current = true;
    setUploading(true);
    setAdaptError(undefined);
    try {
      const preparedFile = await adaptImageForSquareUpload(pendingAdapt.file, adaptMode);
      const asset = await adminApi.uploadAsset(preparedFile, "product", "logo_icon");
      onChange?.(asset.id, asset.url);
      setPendingAdapt(null);
      message.success(
        adaptMode === "original"
          ? `${entityLabel}上传成功，已自动压缩优化为 WebP`
          : `${entityLabel}已完成 1:1 适配并上传，已自动压缩优化为 WebP`,
      );
    } catch (caught) {
      setAdaptError(errorMessage(caught));
    } finally {
      busyRef.current = false;
      setUploading(false);
    }
  };

  const handleCancelAdapt = () => {
    if (uploading) return;
    setPendingAdapt(null);
    setAdaptError(undefined);
  };

  const handleSelectAsset = (asset: AssetRead) => {
    onChange?.(asset.id, asset.url);
    message.success(`已选择素材作为${entityLabel}`);
  };

  const handleRemove = async () => {
    onChange?.(null, null);
    setConfirmRemoval(false);
    message.success(`已移除${entityLabel}关联，保存后生效`);
  };

  const hasLogo = Boolean(url || value);
  const previewBackground =
    adaptMode === "contain_white" ? "#ffffff" : TRANSPARENT_CHECKERBOARD;
  const previewObjectFit = adaptMode === "cover_crop" ? "cover" : "contain";

  return (
    <div>
      {hasLogo ? (
        <Flex gap={16} align="center" wrap="wrap">
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: token.colorFillQuaternary,
              overflow: "hidden",
            }}
          >
            {url ? (
              <Image
                src={url}
                alt={entityLabel}
                style={{
                  maxHeight: 80,
                  maxWidth: 80,
                  objectFit: "contain",
                }}
              />
            ) : (
              <PictureOutlined style={{ fontSize: 32, color: token.colorTextTertiary }} />
            )}
          </div>
          <Flex vertical gap={8}>
            <Flex gap={8} wrap="wrap">
              <Upload
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                beforeUpload={beforeUpload}
                disabled={disabled || uploading}
                maxCount={1}
                showUploadList={false}
              >
                <Button
                  size="small"
                  icon={<UploadOutlined />}
                  loading={uploading}
                  disabled={disabled}
                >
                  重新上传
                </Button>
              </Upload>
              <Button
                size="small"
                icon={<FolderOpenOutlined />}
                disabled={disabled || uploading}
                onClick={() => setModalOpen(true)}
              >
                从素材库选择
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={disabled || uploading}
                onClick={() => setConfirmRemoval(true)}
              >
                移除
              </Button>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已绑定{entityLabel}资产。点击图片可预览大图，修改后需点击弹窗保存生效。
            </Typography.Text>
          </Flex>
        </Flex>
      ) : (
        <Flex vertical gap={8}>
          <Flex gap={8} wrap="wrap">
            <Upload
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              beforeUpload={beforeUpload}
              disabled={disabled || uploading}
              maxCount={1}
              showUploadList={false}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploading}
                disabled={disabled}
              >
                上传{entityLabel}
              </Button>
            </Upload>
            <Button
              icon={<FolderOpenOutlined />}
              disabled={disabled || uploading}
              onClick={() => setModalOpen(true)}
            >
              从素材库选择
            </Button>
          </Flex>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            建议上传 1:1 正方形图片，非正方形上传时可一键适配；支持 JPG、PNG 或 WebP（原图 ≤ {maxSizeMb} MB），系统将自动压缩优化为 ≤ 400px 的 WebP 图片。
          </Typography.Text>
        </Flex>
      )}

      {error && <Alert showIcon type="error" title={error} style={{ marginTop: 8 }} />}

      <Modal
        open={Boolean(pendingAdapt)}
        title={`${entityLabel}上传前 1:1 适配`}
        okText="应用并上传"
        cancelText="取消"
        confirmLoading={uploading}
        closable={!uploading}
        maskClosable={false}
        keyboard={!uploading}
        cancelButtonProps={{ disabled: uploading }}
        onOk={() => {
          void handleConfirmAdapt();
        }}
        onCancel={handleCancelAdapt}
        destroyOnHidden
      >
        {pendingAdapt && (
          <Flex vertical gap={16}>
            <Typography.Text type="secondary">
              检测到当前原图尺寸为 {pendingAdapt.width} × {pendingAdapt.height} px（非 1:1 正方形）。小程序中将展示在圆形或方形图标槽位，请选择处理方式：
            </Typography.Text>

            <Flex
              gap={24}
              justify="center"
              align="center"
              style={{
                padding: 16,
                borderRadius: token.borderRadiusLG,
                backgroundColor: token.colorFillQuaternary,
              }}
            >
              <Flex vertical align="center" gap={6}>
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: previewBackground,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <img
                    src={pendingAdapt.previewUrl}
                    alt="方形预览"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: previewObjectFit,
                      display: "block",
                    }}
                  />
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  方形槽位预览
                </Typography.Text>
              </Flex>

              <Flex vertical align="center" gap={6}>
                <div
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: "50%",
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: previewBackground,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <img
                    src={pendingAdapt.previewUrl}
                    alt="圆形预览"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: previewObjectFit,
                      display: "block",
                    }}
                  />
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  圆形槽位预览
                </Typography.Text>
              </Flex>
            </Flex>

            <Radio.Group
              value={adaptMode}
              disabled={uploading}
              onChange={(event) => {
                setAdaptMode(event.target.value as SquareAdaptMode);
                setAdaptError(undefined);
              }}
            >
              <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                {ADAPT_MODE_OPTIONS.map((option) => (
                  <Radio key={option.value} value={option.value}>
                    <Flex vertical gap={2}>
                      <Typography.Text strong={adaptMode === option.value}>
                        {option.title}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {option.description}
                      </Typography.Text>
                    </Flex>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>

            {adaptError && <Alert showIcon type="error" title={adaptError} />}
          </Flex>
        )}
      </Modal>

      <AssetSelectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleSelectAsset}
        selectedAssetId={value}
        scene="product"
        title={`选择${entityLabel}素材`}
      />

      <StandardConfirmModal
        open={confirmRemoval}
        title={`确认移除${entityLabel}`}
        description={`移除选中的${entityLabel}后，保存表单即可解除关联；已上传的文件资产仍保留在素材库中。取消将保留现有草稿。`}
        loading={false}
        onCancel={() => setConfirmRemoval(false)}
        onConfirm={handleRemove}
      />
    </div>
  );
}

export default BrandLogoPicker;
