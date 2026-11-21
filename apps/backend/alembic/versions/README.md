# Alembic versions

此目录是 Backend 数据库结构的 Alembic 迁移链。当前源码 head 为 `20261121_01`，包含商家、物业、积分预占、核销与结算结构。模型及运行记录见[数据库字典](../../../../docs/architecture/database-schema-guide.md#131-当前源码及迁移盘点)。

迁移须人工审查。数据库执行需核对目标、版本、备份及恢复方式，并取得当前任务的迁移授权。权限目录由独立命令同步。
