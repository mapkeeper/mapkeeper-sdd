"""T223: the Data Model's status combination table, plus what it leaves unnamed."""

import pytest

from mapkeeper.models import PlatformSyncTaskStatus, SyncJobStatus
from mapkeeper.services.status_aggregation import aggregate_status

T = PlatformSyncTaskStatus


@pytest.mark.parametrize(
    ("tasks", "expected"),
    [
        ((T.PENDING, T.PENDING, T.PENDING), SyncJobStatus.PENDING),
        ((T.PROCESSING, T.PENDING, T.PENDING), SyncJobStatus.PROCESSING),
        ((T.SUCCESS, T.PROCESSING, T.FAILED), SyncJobStatus.PROCESSING),
        ((T.RETRYING, T.SUCCESS, T.SUCCESS), SyncJobStatus.RETRYING),
        ((T.SUCCESS, T.SUCCESS, T.SUCCESS), SyncJobStatus.SUCCESS),
        ((T.SUCCESS, T.FAILED, T.SUCCESS), SyncJobStatus.PARTIAL_SUCCESS),
        ((T.FAILED, T.FAILED, T.FAILED), SyncJobStatus.FAILED),
    ],
)
def test_the_contract_status_table_is_implemented(
    tasks: tuple[PlatformSyncTaskStatus, ...],
    expected: SyncJobStatus,
) -> None:
    # Given: one row of the Data Model's status combination table.

    # When / Then: the job reports the status the table fixes.
    assert aggregate_status(tasks) is expected


def test_processing_outranks_retrying() -> None:
    # Given: one platform running while another waits to be retried.

    # When / Then: the table lists PROCESSING first, so it wins.
    assert aggregate_status((T.PROCESSING, T.RETRYING, T.SUCCESS)) is SyncJobStatus.PROCESSING


@pytest.mark.parametrize(
    "tasks",
    [
        (T.PENDING, T.SUCCESS, T.SUCCESS),
        (T.PENDING, T.FAILED, T.SUCCESS),
        (T.PENDING, T.FAILED, T.FAILED),
    ],
)
def test_a_platform_that_has_not_started_keeps_the_job_in_flight(
    tasks: tuple[PlatformSyncTaskStatus, ...],
) -> None:
    # Given: a combination the table does not name, seen while a job runs.

    # When / Then: the job is not finished, so a client keeps polling.
    assert aggregate_status(tasks) is SyncJobStatus.PROCESSING


def test_partial_success_needs_both_a_success_and_a_failure() -> None:
    # Given: results that are all of one kind.

    # When / Then: PARTIAL_SUCCESS never describes a uniform outcome.
    assert aggregate_status((T.SUCCESS, T.SUCCESS)) is not SyncJobStatus.PARTIAL_SUCCESS
    assert aggregate_status((T.FAILED, T.FAILED)) is not SyncJobStatus.PARTIAL_SUCCESS


def test_a_job_without_platform_results_is_rejected() -> None:
    # Given: no platform results at all, which the schema forbids.

    # When / Then: the caller learns the data is wrong instead of getting a guess.
    with pytest.raises(ValueError, match="at least one platform task"):
        _ = aggregate_status(())
