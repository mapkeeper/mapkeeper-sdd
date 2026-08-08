import io
import re
from enum import StrEnum
from pathlib import Path
from typing import Final

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from mapkeeper.models import (
    Base,
    ContentGenerationStatus,
    Platform,
    PlatformSyncTaskStatus,
    ProposalStatus,
    SyncJobStatus,
    SyncSourceType,
)

INITIAL_REVISION: Final = "0001"
ENUM_TYPES: Final = {
    "platform": Platform,
    "proposal_status": ProposalStatus,
    "content_generation_status": ContentGenerationStatus,
    "sync_job_status": SyncJobStatus,
    "platform_sync_task_status": PlatformSyncTaskStatus,
    "sync_source_type": SyncSourceType,
}


def _config(backend_root: Path) -> Config:
    config = Config(str(backend_root / "alembic.ini"))
    config.attributes["configure_logger"] = False
    return config


def _run_offline(backend_root: Path, upgrade: bool) -> str:
    buffer = io.StringIO()
    config = _config(backend_root)
    config.output_buffer = buffer
    if upgrade:
        command.upgrade(config, "head", sql=True)
    else:
        command.downgrade(config, "head:base", sql=True)
    return buffer.getvalue()


@pytest.fixture
def upgrade_sql(backend_root: Path) -> str:
    """Return the SQL an upgrade against an empty database would emit."""
    return _run_offline(backend_root, upgrade=True)


@pytest.fixture
def downgrade_sql(backend_root: Path) -> str:
    """Return the SQL a full downgrade back to an empty database would emit."""
    return _run_offline(backend_root, upgrade=False)


def _create_table_block(sql: str, table_name: str) -> str:
    match = re.search(rf"CREATE TABLE {table_name} \((.*?)\n\);", sql, re.DOTALL)
    assert match is not None, f"{table_name} is missing from the migration"
    return match.group(1)


def test_the_schema_has_a_single_migration_head(backend_root: Path) -> None:
    # Given: the migration history on disk.
    script_directory = ScriptDirectory.from_config(_config(backend_root))

    # When: the heads are resolved.
    heads = script_directory.get_heads()

    # Then: one linear history exists, starting from the initial revision.
    assert list(heads) == [INITIAL_REVISION]
    assert script_directory.get_revision(INITIAL_REVISION).down_revision is None


def test_upgrade_runs_against_an_empty_database(upgrade_sql: str) -> None:
    # Given: an empty database with no MapKeeper schema.

    # When: the migration is generated offline.

    # Then: it bootstraps its own version table before creating the schema.
    assert "CREATE TABLE alembic_version" in upgrade_sql
    assert "INSERT INTO alembic_version (version_num)" in upgrade_sql
    assert f"('{INITIAL_REVISION}')" in upgrade_sql


@pytest.mark.parametrize("table_name", sorted(Base.metadata.tables))
def test_upgrade_creates_every_mapped_table(upgrade_sql: str, table_name: str) -> None:
    # Given: one table declared by the SQLAlchemy models.

    # When / Then: the migration creates it.
    assert f"CREATE TABLE {table_name} (" in upgrade_sql


@pytest.mark.parametrize("table_name", sorted(Base.metadata.tables))
def test_upgrade_creates_every_mapped_column(upgrade_sql: str, table_name: str) -> None:
    # Given: one mapped table and the migration statement that creates it.
    block = _create_table_block(upgrade_sql, table_name)

    # When: the model columns are compared with the migration.
    missing = [
        column.name
        for column in Base.metadata.tables[table_name].columns
        if not re.search(rf"^\s+{column.name}\s", block, re.MULTILINE)
    ]

    # Then: the migration and the models describe the same table.
    assert missing == []


@pytest.mark.parametrize(
    "constraint_name",
    [
        "ck_store_profile_temporary_closure_range",
        "ck_content_generation_positive_revision",
        "ck_sync_job_source_exclusivity",
        "ck_platform_sync_task_attempt_count_range",
        "uq_local_seo_content_content_generation_id_platform",
        "uq_sync_job_approved_by_idempotency_key",
        "uq_platform_sync_task_sync_job_id_platform",
    ],
)
def test_upgrade_applies_the_required_integrity_constraints(
    upgrade_sql: str,
    constraint_name: str,
) -> None:
    # Given: one constraint the Data Model requires the database to enforce.

    # When / Then: the migration creates it under the shared naming convention.
    assert f"CONSTRAINT {constraint_name}" in upgrade_sql


@pytest.mark.parametrize(("type_name", "enum_type"), sorted(ENUM_TYPES.items()))
def test_upgrade_creates_each_enum_type_once(
    upgrade_sql: str,
    type_name: str,
    enum_type: type[StrEnum],
) -> None:
    # Given: one domain enum shared by the API and the database.
    rendered = ", ".join(f"'{member.value}'" for member in enum_type)

    # When / Then: the type is created exactly once with the contract's values.
    assert upgrade_sql.count(f"CREATE TYPE {type_name} AS ENUM") == 1
    assert f"CREATE TYPE {type_name} AS ENUM ({rendered});" in upgrade_sql


def test_downgrade_removes_every_table_and_enum_type(downgrade_sql: str) -> None:
    # Given: a database already migrated to head.

    # When: a full downgrade is generated offline.

    # Then: nothing MapKeeper created is left behind.
    for table_name in Base.metadata.tables:
        assert f"DROP TABLE {table_name};" in downgrade_sql
    for type_name in ENUM_TYPES:
        assert f"DROP TYPE {type_name};" in downgrade_sql
    assert "DELETE FROM alembic_version" in downgrade_sql


def test_downgrade_drops_children_before_their_parents(downgrade_sql: str) -> None:
    # Given: the generated downgrade SQL.
    order = [
        downgrade_sql.index(f"DROP TABLE {table_name};") for table_name in Base.metadata.tables
    ]

    # When: the drop order is compared with the foreign-key hierarchy.
    profile_position = downgrade_sql.index("DROP TABLE store_profile;")

    # Then: referencing tables are dropped first, so no foreign key blocks the rollback.
    assert profile_position == max(order)
    assert downgrade_sql.index("DROP TABLE platform_sync_task;") < downgrade_sql.index(
        "DROP TABLE sync_job;"
    )
    assert downgrade_sql.index("DROP TABLE local_seo_content;") < downgrade_sql.index(
        "DROP TABLE content_generation;"
    )
