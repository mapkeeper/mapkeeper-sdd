"""T223: turn three platform results into one job status.

The Data Model fixes six combinations:

    all PENDING            -> PENDING
    any PROCESSING         -> PROCESSING
    any RETRYING           -> RETRYING
    all SUCCESS            -> SUCCESS
    SUCCESS with FAILED    -> PARTIAL_SUCCESS
    all FAILED             -> FAILED

Two more can occur while a job runs and the table does not name them: PENDING
mixed with a finished platform, and PROCESSING together with RETRYING. Both are
treated as work still in flight, so the job reports PROCESSING and a client keeps
polling instead of being told a mixed result is final.
"""

from collections.abc import Iterable, Sequence

from mapkeeper.models import PlatformSyncTask, PlatformSyncTaskStatus, SyncJobStatus

TERMINAL_TASK_STATUSES = frozenset({PlatformSyncTaskStatus.SUCCESS, PlatformSyncTaskStatus.FAILED})


def aggregate_status(statuses: Iterable[PlatformSyncTaskStatus]) -> SyncJobStatus:
    """Return the job status these platform results add up to.

    Raises:
        ValueError: no platform result was supplied, so there is nothing to report.
    """
    collected: Sequence[PlatformSyncTaskStatus] = tuple(statuses)
    if not collected:
        message = "a sync job always has at least one platform task"
        raise ValueError(message)

    present = frozenset(collected)
    if present == frozenset({PlatformSyncTaskStatus.PENDING}):
        return SyncJobStatus.PENDING
    if PlatformSyncTaskStatus.PROCESSING in present:
        return SyncJobStatus.PROCESSING
    if PlatformSyncTaskStatus.RETRYING in present:
        return SyncJobStatus.RETRYING
    if not present <= TERMINAL_TASK_STATUSES:
        # A platform has not started yet while another already finished.
        return SyncJobStatus.PROCESSING
    return _terminal_status(present)


def _terminal_status(present: frozenset[PlatformSyncTaskStatus]) -> SyncJobStatus:
    if present == frozenset({PlatformSyncTaskStatus.SUCCESS}):
        return SyncJobStatus.SUCCESS
    if present == frozenset({PlatformSyncTaskStatus.FAILED}):
        return SyncJobStatus.FAILED
    return SyncJobStatus.PARTIAL_SUCCESS


def aggregate_task_status(tasks: Iterable[PlatformSyncTask]) -> SyncJobStatus:
    """Return the job status the given platform tasks add up to."""
    return aggregate_status(task.status for task in tasks)
