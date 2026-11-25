"""为文件资产表新增可选 480px 缩略图元数据字段与约束。

Revision ID: 20261125_02
Revises: 20261125_01
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261125_02"
down_revision: str | None = "20261125_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assets",
        sa.Column("thumb_file_key", sa.String(length=500), nullable=True, comment="480px 缩略图存储相对文件键"),
    )
    op.add_column(
        "assets",
        sa.Column("thumb_url", sa.String(length=1000), nullable=True, comment="480px 缩略图公开访问 URL 或站内路径"),
    )
    op.add_column(
        "assets", sa.Column("thumb_file_size", sa.BigInteger(), nullable=True, comment="480px 缩略图文件字节数")
    )
    op.add_column("assets", sa.Column("thumb_width", sa.Integer(), nullable=True, comment="480px 缩略图宽度，像素"))
    op.add_column("assets", sa.Column("thumb_height", sa.Integer(), nullable=True, comment="480px 缩略图高度，像素"))
    op.create_unique_constraint("uq_assets_thumb_file_key", "assets", ["thumb_file_key"])
    op.create_check_constraint(
        "ck_assets_thumb_metadata",
        "assets",
        "(thumb_file_key IS NULL AND thumb_url IS NULL AND thumb_file_size IS NULL "
        "AND thumb_width IS NULL AND thumb_height IS NULL) OR "
        "(thumb_file_key IS NOT NULL AND thumb_url IS NOT NULL AND thumb_file_size IS NOT NULL "
        "AND thumb_width IS NOT NULL AND thumb_height IS NOT NULL "
        "AND thumb_file_size > 0 AND thumb_width > 0 AND thumb_height > 0)",
    )


def downgrade() -> None:
    if (
        op.get_bind().execute(sa.text("SELECT 1 FROM assets WHERE thumb_file_key IS NOT NULL LIMIT 1")).scalar()
        is not None
    ):
        raise RuntimeError("存在已生成的缩略图资产元数据，禁止有损降级；请先备份并采用前向修复。")
    op.drop_constraint("ck_assets_thumb_metadata", "assets", type_="check")
    op.drop_constraint("uq_assets_thumb_file_key", "assets", type_="unique")
    op.drop_column("assets", "thumb_height")
    op.drop_column("assets", "thumb_width")
    op.drop_column("assets", "thumb_file_size")
    op.drop_column("assets", "thumb_url")
    op.drop_column("assets", "thumb_file_key")
