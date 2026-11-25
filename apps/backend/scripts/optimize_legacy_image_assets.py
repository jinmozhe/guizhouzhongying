"""离线检查或批量将存量历史图片资产转换为 WebP 并补齐 480px 缩略图。"""

import argparse
import asyncio
from collections import Counter
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings
from app.core.resources import create_resources
from app.db.models import Asset
from app.services.asset_image_optimizer import AssetImageOptimizer
from app.services.storage import IMAGE_PROFILES, create_storage_provider
from scripts._database_target import validate_database_target

_IMAGE_MIMES = ("image/jpeg", "image/png", "image/webp")


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查或离线优化存量静态图片为 WebP 并按需补齐 480px 缩略图")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", "--check", dest="dry_run", action="store_true", help="只读预演，默认模式")
    mode.add_argument("--apply", action="store_true", help="显式改写磁盘文件与资产元数据")
    parser.add_argument("--confirm-database", required=True, help="目标数据库名称，防止误操作非目标库")
    parser.add_argument("--scene", choices=["product", "avatar", "article"], default=None, help="仅处理指定场景")
    parser.add_argument(
        "--profile",
        choices=sorted(IMAGE_PROFILES.keys()),
        default=None,
        help="强制使用指定图片档位；默认按引用关系自动推断",
    )
    parser.add_argument("--asset-id", action="append", type=UUID, default=[], help="明确指定资产 ID，可重复传入")
    parser.add_argument("--limit", type=int, default=100, help="单批处理上限（1 至 200）")
    args = parser.parse_args()
    if not 1 <= args.limit <= 200 or len(args.asset_id) > 200 or len(set(args.asset_id)) != len(args.asset_id):
        parser.error("每批仅允许 1 至 200 项且资产 ID 不能重复")
    return args


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings()
    validate_database_target(settings, args.confirm_database)
    resources = create_resources(settings)
    try:
        storage = create_storage_provider(settings)
        if args.asset_id:
            if len(args.asset_id) > args.limit:
                raise ValueError("明确指定的资产数量超过 --limit")
            ids = sorted(args.asset_id)
        else:
            async with resources.session_factory() as session:
                statement = select(Asset.id).where(
                    Asset.storage_driver == storage.driver,
                    Asset.mime_type.in_(_IMAGE_MIMES),
                )
                if args.scene is not None:
                    statement = statement.where(Asset.scene == args.scene)
                ids = list(await session.scalars(statement.order_by(Asset.id).limit(args.limit)))

        optimizer = AssetImageOptimizer(resources.session_factory, storage, settings)
        counts: Counter[str] = Counter()
        total_old = 0
        total_new = 0
        total_thumb = 0
        for asset_id in ids:
            result = await optimizer.run_one(asset_id, apply=args.apply, profile_override=args.profile)
            counts[result.status] += 1
            total_old += result.old_bytes
            total_new += result.new_bytes
            total_thumb += result.thumb_bytes
            print(
                f"asset_id={result.asset_id} profile={result.profile} status={result.status} "
                f"old={result.old_bytes} new={result.new_bytes} thumb={result.thumb_bytes}"
            )
        mode_name = "apply" if args.apply else "dry-run"
        print(
            f"mode={mode_name} selected={len(ids)} counts={dict(counts)} "
            f"total_old_bytes={total_old} total_new_bytes={total_new} total_thumb_bytes={total_thumb}"
        )
        ok_statuses = {"updated", "already_optimized", "ready"}
        return 1 if any(status not in ok_statuses for status in counts) else 0
    except SQLAlchemyError:
        print("数据库操作失败；未完成批次不得视为成功，请通过服务日志核查。")
        return 1
    finally:
        await resources.close()


def main() -> None:
    raise SystemExit(asyncio.run(_run(_arguments())))


if __name__ == "__main__":
    main()
