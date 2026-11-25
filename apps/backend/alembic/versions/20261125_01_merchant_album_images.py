"""新增商家相册图片有序关联表。

Revision ID: 20261125_01
Revises: 20261123_01
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261125_01"
down_revision: str | None = "20261123_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "merchant_album_images",
        sa.Column("merchant_id", sa.Uuid(), nullable=False, comment="所属商家"),
        sa.Column("asset_id", sa.Uuid(), nullable=False, comment="引用图片资产"),
        sa.Column("position", sa.Integer(), nullable=False, comment="相册内连续展示序号"),
        sa.PrimaryKeyConstraint("merchant_id", "asset_id"),
        sa.ForeignKeyConstraint(["merchant_id"], ["merchants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("merchant_id", "position", name="uq_merchant_album_image_position"),
        sa.CheckConstraint("position >= 0", name="ck_merchant_album_image_position"),
        comment="商家相册图片的独立有序资产引用",
    )
    op.create_index("ix_merchant_album_images_asset", "merchant_album_images", ["asset_id"])


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT 1 FROM merchant_album_images LIMIT 1")).scalar() is not None:
        raise RuntimeError("存在商家相册图片关联，禁止有损降级；请先备份并采用前向修复。")
    op.drop_table("merchant_album_images")
