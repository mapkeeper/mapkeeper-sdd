import re
from typing import Final

import pytest
from sqlalchemy import Table
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import configure_mappers
from sqlalchemy.schema import CreateTable

from mapkeeper.models import (
    Base,
    ContentGenerationStatus,
    Platform,
    PlatformSyncTaskStatus,
    ProposalStatus,
    SyncJobStatus,
    SyncSourceType,
)

EXPECTED_TABLES: Final = frozenset(
    {
        "store_profile",
        "store_change_proposal",
        "content_generation",
        "local_seo_content",
        "sync_job",
        "platform_sync_task",
        "source_review",
    }
)
# SourceReview is write-once: the Data Model gives it createdAt only.
TABLES_WITH_UPDATED_AT: Final = EXPECTED_TABLES - {"source_review"}


PROPOSAL_SOURCE_BRANCH: Final = """source_type = 'STORE_CHANGE_PROPOSAL'
    AND store_change_proposal_id IS NOT NULL
    AND content_generation_id IS NULL"""
GENERATION_SOURCE_BRANCH: Final = """source_type = 'CONTENT_GENERATION'
    AND content_generation_id IS NOT NULL
    AND store_change_proposal_id IS NULL"""


def _table(name: str) -> Table:
    return Base.metadata.tables[name]


def _ddl(name: str) -> str:
    return str(CreateTable(_table(name)).compile(dialect=postgresql.dialect()))


def _column_definition(name: str, column: str) -> str:
    ddl = _ddl(name)
    match = re.search(rf"^\s+{column} (.+?),?\s*$", ddl, re.MULTILINE)
    assert match is not None, f"{name}.{column} is not part of the generated DDL"
    return match.group(1)


def test_metadata_contains_exactly_the_data_model_tables() -> None:
    # Given: the declarative metadata of every mapped model.

    # When: the mapped table names are collected.
    tables = frozenset(Base.metadata.tables)

    # Then: only the entities defined by the Data Model exist.
    assert tables == EXPECTED_TABLES


def test_every_relationship_resolves() -> None:
    # Given: models declared across several modules.

    # When / Then: SQLAlchemy can configure every mapper without a missing target.
    configure_mappers()


@pytest.mark.parametrize("table_name", sorted(EXPECTED_TABLES))
def test_every_table_compiles_for_postgresql(table_name: str) -> None:
    # Given: one mapped table.

    # When / Then: it renders valid PostgreSQL DDL.
    assert _ddl(table_name).startswith(f"\nCREATE TABLE {table_name} (")


@pytest.mark.parametrize(
    ("column", "definition"),
    [
        ("business_hours", "JSONB NOT NULL"),
        ("platform_account_refs", "JSONB NOT NULL"),
        ("representative_menu_name", "VARCHAR(50) NOT NULL"),
        ("temporary_closure_start_date", "DATE"),
        ("temporary_closure_end_date", "DATE"),
    ],
)
def test_store_profile_stores_the_approved_target_state(column: str, definition: str) -> None:
    # Given: the StoreProfile columns from the Data Model.

    # When / Then: hours are structured JSONB, the menu limit is 50 and closure dates are optional.
    assert _column_definition("store_profile", column) == definition


def test_store_profile_constrains_the_temporary_closure_period() -> None:
    # Given: the generated StoreProfile DDL.
    ddl = _ddl("store_profile")

    # When / Then: both dates are required together and cannot be inverted.
    assert "CONSTRAINT ck_store_profile_temporary_closure_range CHECK" in ddl
    assert "temporary_closure_start_date IS NULL AND temporary_closure_end_date IS NULL" in ddl
    assert "temporary_closure_end_date >= temporary_closure_start_date" in ddl


@pytest.mark.parametrize(
    ("column", "definition"),
    [
        ("recognized_text_masked", "VARCHAR(500) NOT NULL"),
        ("changes", "JSONB NOT NULL"),
        ("status", "proposal_status NOT NULL"),
        ("approved_at", "TIMESTAMP WITH TIME ZONE"),
        ("rejected_at", "TIMESTAMP WITH TIME ZONE"),
    ],
)
def test_store_change_proposal_keeps_masked_text_and_validated_changes(
    column: str,
    definition: str,
) -> None:
    # Given: the StoreChangeProposal columns from the Data Model.

    # When / Then: masked text is capped at 500 and structured changes are stored as JSONB.
    assert _column_definition("store_change_proposal", column) == definition


@pytest.mark.parametrize(
    ("column", "definition"),
    [
        ("brief_text", "VARCHAR(500) NOT NULL"),
        ("purpose", "content_purpose DEFAULT 'INTRODUCTION' NOT NULL"),
        ("seed_keywords", "TEXT[] NOT NULL"),
        ("source_review_ids", "UUID[]"),
        ("status", "content_generation_status NOT NULL"),
        ("revision", "INTEGER DEFAULT 1 NOT NULL"),
    ],
)
def test_content_generation_stores_the_common_uc2_input(column: str, definition: str) -> None:
    # Given: the ContentGeneration columns from the Data Model.

    # When / Then: the common input, its status and its revision are persisted.
    assert _column_definition("content_generation", column) == definition


def test_content_generation_revision_never_drops_below_one() -> None:
    # Given: the generated ContentGeneration DDL.
    ddl = _ddl("content_generation")

    # When / Then: the first revision is the lowest the database accepts.
    assert "CONSTRAINT ck_content_generation_positive_revision CHECK (revision >= 1)" in ddl


@pytest.mark.parametrize(
    ("column", "definition"),
    [
        ("platform", "platform NOT NULL"),
        ("draft_text", "VARCHAR(750) NOT NULL"),
        ("keywords", "TEXT[] NOT NULL"),
        ("content_rules", "JSONB NOT NULL"),
    ],
)
def test_local_seo_content_holds_one_result_per_platform(column: str, definition: str) -> None:
    # Given: the LocalSEOContent columns from the Data Model.

    # When / Then: generated copy is capped at 750 characters with platform keywords.
    assert _column_definition("local_seo_content", column) == definition


def test_local_seo_content_cannot_repeat_a_platform_within_one_generation() -> None:
    # Given: the generated LocalSEOContent DDL.
    ddl = _ddl("local_seo_content")

    # When / Then: exactly one result per platform can exist per generation.
    assert "CONSTRAINT uq_local_seo_content_content_generation_id_platform" in ddl
    assert "UNIQUE (content_generation_id, platform)" in ddl


def test_local_seo_content_has_no_approval_state() -> None:
    # Given: the LocalSEOContent table.

    # When: its column names are collected.
    columns = frozenset(_table("local_seo_content").columns.keys())

    # Then: approval is owned by the parent generation only.
    assert columns.isdisjoint({"status", "approved_at", "rejected_at"})


@pytest.mark.parametrize(
    ("column", "definition"),
    [
        ("source_type", "sync_source_type NOT NULL"),
        ("store_change_proposal_id", "UUID"),
        ("content_generation_id", "UUID"),
        ("status", "sync_job_status NOT NULL"),
        ("approved_at", "TIMESTAMP WITH TIME ZONE NOT NULL"),
        ("approved_by", "UUID NOT NULL"),
        ("idempotency_key", "VARCHAR(128) NOT NULL"),
        ("idempotency_request_hash", "CHAR(64) NOT NULL"),
    ],
)
def test_sync_job_records_the_approval_and_its_idempotency(column: str, definition: str) -> None:
    # Given: the SyncJob columns from the Data Model.

    # When / Then: both source foreign keys are optional and the SHA-256 hash is 64 characters.
    assert _column_definition("sync_job", column) == definition


def test_sync_job_accepts_exactly_one_approval_source() -> None:
    # Given: the generated SyncJob DDL.
    ddl = _ddl("sync_job")

    # When / Then: each source type requires its own foreign key and forbids the other.
    assert "CONSTRAINT ck_sync_job_source_exclusivity CHECK" in ddl
    assert PROPOSAL_SOURCE_BRANCH in ddl
    assert GENERATION_SOURCE_BRANCH in ddl


def test_sync_job_makes_approval_idempotent_per_actor() -> None:
    # Given: the generated SyncJob DDL.
    ddl = _ddl("sync_job")

    # When / Then: one actor cannot reuse an Idempotency-Key for a second job.
    assert "CONSTRAINT uq_sync_job_approved_by_idempotency_key" in ddl
    assert "UNIQUE (approved_by, idempotency_key)" in ddl


@pytest.mark.parametrize(
    ("column", "definition"),
    [
        ("platform", "platform NOT NULL"),
        ("status", "platform_sync_task_status NOT NULL"),
        ("attempt_count", "INTEGER DEFAULT 0 NOT NULL"),
        ("next_retry_at", "TIMESTAMP WITH TIME ZONE"),
        ("error_code", "TEXT"),
        ("error_message", "TEXT"),
        ("retryable", "BOOLEAN"),
        ("last_attempt_at", "TIMESTAMP WITH TIME ZONE"),
    ],
)
def test_platform_sync_task_records_normalized_error_details(
    column: str,
    definition: str,
) -> None:
    # Given: the PlatformSyncTask columns from the Data Model.

    # When / Then: every failure detail is optional so successful tasks stay clean.
    assert _column_definition("platform_sync_task", column) == definition


def test_platform_sync_task_bounds_attempts_and_platform_uniqueness() -> None:
    # Given: the generated PlatformSyncTask DDL.
    ddl = _ddl("platform_sync_task")

    # When / Then: a job runs each platform once, at most three times.
    assert "CONSTRAINT ck_platform_sync_task_attempt_count_range" in ddl
    assert "CHECK (attempt_count >= 0 AND attempt_count <= 3)" in ddl
    assert "CONSTRAINT uq_platform_sync_task_sync_job_id_platform" in ddl
    assert "UNIQUE (sync_job_id, platform)" in ddl


def test_platform_enum_uses_the_contract_lowercase_values() -> None:
    # Given: the platform column shared by results and sync tasks.

    # When: the rendered column type is inspected.
    on_content = _column_definition("local_seo_content", "platform")
    on_task = _column_definition("platform_sync_task", "platform")

    # Then: both reuse one native enum type holding the contract's lowercase values.
    assert on_content == on_task == "platform NOT NULL"
    assert [member.value for member in Platform] == ["google", "naver", "kakao"]


def test_partial_success_aggregates_platforms_and_never_describes_one() -> None:
    # Given: the aggregate and per-platform status enums.

    # When: their members are compared.
    job_values = [member.value for member in SyncJobStatus]
    task_values = [member.value for member in PlatformSyncTaskStatus]

    # Then: PARTIAL_SUCCESS exists only on the job that aggregates three platforms.
    assert "PARTIAL_SUCCESS" in job_values
    assert "PARTIAL_SUCCESS" not in task_values


def test_proposal_and_generation_share_the_same_lifecycle() -> None:
    # Given: the two draft-based approval enums.

    # When: their members are compared.
    proposal_values = [member.value for member in ProposalStatus]
    generation_values = [member.value for member in ContentGenerationStatus]

    # Then: both move from DRAFT to exactly one terminal state.
    assert proposal_values == ["DRAFT", "APPROVED", "REJECTED"]
    assert generation_values == proposal_values


def test_sync_source_type_covers_both_use_cases() -> None:
    # Given: the enum naming which approval created a job.

    # When / Then: UC1 proposals and UC2 generations are the only sources.
    assert [member.value for member in SyncSourceType] == [
        "STORE_CHANGE_PROPOSAL",
        "CONTENT_GENERATION",
    ]


@pytest.mark.parametrize(
    ("table_name", "column", "parent", "on_delete"),
    [
        ("store_change_proposal", "store_profile_id", "store_profile", "CASCADE"),
        ("content_generation", "store_profile_id", "store_profile", "CASCADE"),
        ("local_seo_content", "content_generation_id", "content_generation", "CASCADE"),
        ("sync_job", "store_profile_id", "store_profile", "CASCADE"),
        ("sync_job", "store_change_proposal_id", "store_change_proposal", "RESTRICT"),
        ("sync_job", "content_generation_id", "content_generation", "RESTRICT"),
        ("platform_sync_task", "sync_job_id", "sync_job", "CASCADE"),
        ("source_review", "store_profile_id", "store_profile", "CASCADE"),
    ],
)
def test_foreign_keys_follow_the_data_model_hierarchy(
    table_name: str,
    column: str,
    parent: str,
    on_delete: str,
) -> None:
    # Given: one relationship from the Data Model entity tree.
    clause = f"FOREIGN KEY({column}) REFERENCES {parent} (id) ON DELETE {on_delete}"

    # When / Then: it points at the declared parent with the intended delete behaviour.
    assert clause in _ddl(table_name)


@pytest.mark.parametrize("table_name", sorted(EXPECTED_TABLES))
def test_every_table_records_when_a_row_was_created(table_name: str) -> None:
    # Given: one mapped table.

    # When / Then: creation time is timezone-aware and filled by PostgreSQL.
    definition = _column_definition(table_name, "created_at")
    assert definition == "TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL"


@pytest.mark.parametrize("table_name", sorted(TABLES_WITH_UPDATED_AT))
def test_every_mutable_table_records_when_a_row_changed(table_name: str) -> None:
    # Given: one table whose rows can change after insert.

    # When / Then: modification time is timezone-aware and filled by PostgreSQL.
    definition = _column_definition(table_name, "updated_at")
    assert definition == "TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL"


def test_source_review_is_write_once() -> None:
    # Given: the SourceReview table.
    columns = frozenset(_table("source_review").columns.keys())

    # When / Then: a masked review is never edited, so it carries no updatedAt.
    assert "updated_at" not in columns
    assert columns == {"id", "store_profile_id", "body_masked", "created_at"}


def test_source_review_stores_only_masked_text() -> None:
    # Given: the SourceReview table.

    # When / Then: the column name states that raw customer text never lands here.
    assert _column_definition("source_review", "body_masked") == "TEXT NOT NULL"
