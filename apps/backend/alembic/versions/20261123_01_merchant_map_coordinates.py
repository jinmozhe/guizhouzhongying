"""为商家增加可选地图坐标。"""

import sqlalchemy as sa

from alembic import op

revision = "20261123_01"
down_revision = "20261121_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("merchants", sa.Column("latitude", sa.Numeric(9, 6), nullable=True, comment="公开门店纬度，GCJ-02"))
    op.add_column("merchants", sa.Column("longitude", sa.Numeric(9, 6), nullable=True, comment="公开门店经度，GCJ-02"))
    op.create_check_constraint(
        "ck_merchants_map_coordinates",
        "merchants",
        "(latitude IS NULL AND longitude IS NULL) OR "
        "(latitude IS NOT NULL AND longitude IS NOT NULL AND "
        "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_merchants_map_coordinates", "merchants", type_="check")
    op.drop_column("merchants", "longitude")
    op.drop_column("merchants", "latitude")
