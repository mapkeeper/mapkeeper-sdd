"""T225 end to end: the status and retry endpoints over a live database.

The API runs on its own event loop, so these checks commit their fixtures and clean
them up afterwards instead of sharing the test's session.
"""

from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Final
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from mapkeeper.core.config import get_settings
from mapkeeper.db.session import get_engine, get_session_factory
from mapkeeper.main import app
from mapkeeper.models import (
    Platform,
    PlatformErrorCode,
    PlatformSyncTaskStatus,
    SyncJobStatus,
    SyncSourceType,
)
from mapkeeper.services.approval import ApprovalRequest, ApprovalSource, create_sync_job
from mapkeeper.services.sync_runner import load_tasks
from tests.jsonassert import arr, body_of, obj, text_of

from .factories import make_proposal, make_store_profile

pytestmark = pytest.mark.asyncio

FAILURE_MESSAGE: Final = "플랫폼 서버에 일시적인 문제가 있습니다."


@dataclass(frozen=True)
class SeededJob:
    """A committed job the API can read, plus what to delete afterwards."""

    job_id: UUID
    store_profile_id: UUID


@pytest_asyncio.fixture
async def api(
    integration_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[str, None]:
    """Point the application at the disposable database and clean up after."""
    monkeypatch.setenv("DATABASE_URL", integration_database_url)
    get_settings.cache_clear()
    get_session_factory.cache_clear()
    get_engine.cache_clear()

    # The API answers on its own event loop, so pooling a connection across tests
    # would hand the next loop a socket the previous one owned. NullPool avoids it.
    engine = create_async_engine(integration_database_url, poolclass=NullPool)
    monkeypatch.setattr("mapkeeper.db.session.get_engine", lambda: engine)

    await _reset(integration_database_url)
    try:
        yield integration_database_url
    finally:
        await _reset(integration_database_url)
        await engine.dispose()
        get_session_factory.cache_clear()


async def _reset(url: str) -> None:
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.begin() as connection:
            _ = await connection.execute(text("DELETE FROM sync_job"))
            _ = await connection.execute(text("DELETE FROM store_profile"))
    finally:
        await engine.dispose()


@pytest.fixture
def client() -> TestClient:
    """Return a client that does not run startup, which is exercised elsewhere."""
    return TestClient(app)


async def seed_failed_job(url: str, *, retryable: bool) -> SeededJob:
    """Commit a job where Naver failed and the other platforms succeeded."""
    engine = create_async_engine(url, poolclass=NullPool)
    factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with factory() as session, session.begin():
            profile = await make_store_profile(session)
            proposal = await make_proposal(session, profile.id)
            result = await create_sync_job(
                session,
                ApprovalSource(
                    store_profile_id=profile.id,
                    source_type=SyncSourceType.STORE_CHANGE_PROPOSAL,
                    store_change_proposal_id=proposal.id,
                ),
                ApprovalRequest(uuid4(), f"key-{uuid4().hex}", "a" * 64),
            )
            job = result.sync_job
            for task in await load_tasks(session, job.id):
                task.attempt_count = 1
                if task.platform is Platform.NAVER:
                    task.status = PlatformSyncTaskStatus.FAILED
                    task.error_code = PlatformErrorCode.PLATFORM_SERVER_ERROR.value
                    task.error_message = FAILURE_MESSAGE
                    task.retryable = retryable
                else:
                    task.status = PlatformSyncTaskStatus.SUCCESS
            job.status = SyncJobStatus.PARTIAL_SUCCESS
            return SeededJob(job_id=job.id, store_profile_id=profile.id)
    finally:
        await engine.dispose()


async def test_a_partially_failed_job_is_reported_with_http_200(
    api: str,
    client: TestClient,
) -> None:
    # Given: a job where one platform failed and two succeeded.
    seeded = await seed_failed_job(api, retryable=True)

    # When: the status is polled.
    response = client.get(f"/api/v1/sync-jobs/{seeded.job_id}")
    body = body_of(response.text)

    # Then: reading the status succeeded even though a platform did not.
    assert response.status_code == status.HTTP_200_OK
    assert body["success"] is True
    assert text_of(body["status"]) == "SUCCESS"
    assert text_of(obj(body["data"])["status"]) == SyncJobStatus.PARTIAL_SUCCESS.value


async def test_the_status_reports_each_platform_separately(
    api: str,
    client: TestClient,
) -> None:
    # Given: a partially failed job.
    seeded = await seed_failed_job(api, retryable=True)

    # When: the status is polled.
    data = obj(body_of(client.get(f"/api/v1/sync-jobs/{seeded.job_id}").text)["data"])
    tasks = {text_of(obj(task)["platform"]): obj(task) for task in arr(data["platformTasks"])}

    # Then: the failed platform carries a retryable error and the others carry none.
    naver = tasks["naver"]
    assert text_of(naver["status"]) == PlatformSyncTaskStatus.FAILED.value
    error = obj(naver["error"])
    assert text_of(error["code"]) == PlatformErrorCode.PLATFORM_SERVER_ERROR.value
    assert error["retryable"] is True
    assert tasks["google"]["error"] is None


async def test_an_unknown_job_is_reported_as_not_found(api: str, client: TestClient) -> None:
    assert api
    # Given: an id that belongs to no job.

    # When: the status is polled.
    response = client.get(f"/api/v1/sync-jobs/{uuid4()}")

    # Then: the client sees the contract's 404 envelope.
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert text_of(obj(body_of(response.text)["error"])["code"]) == "RESOURCE_NOT_FOUND"


async def test_retrying_a_failed_platform_is_accepted(
    api: str,
    client: TestClient,
) -> None:
    # Given: a job with one retryable failure.
    seeded = await seed_failed_job(api, retryable=True)

    # When: the user asks to retry.
    response = client.post(f"/api/v1/sync-jobs/{seeded.job_id}/retry")
    body = body_of(response.text)
    data = obj(body["data"])

    # Then: only the failed platform is queued and the client is told where to poll.
    assert response.status_code == status.HTTP_202_ACCEPTED
    assert text_of(body["status"]) == "PROCESSING"
    assert [text_of(item) for item in arr(data["retryingPlatforms"])] == ["naver"]
    assert text_of(data["statusUrl"]) == f"/api/v1/sync-jobs/{seeded.job_id}"


async def test_retrying_with_nothing_retryable_is_a_conflict(
    api: str,
    client: TestClient,
) -> None:
    # Given: a job whose only failure cannot be retried.
    seeded = await seed_failed_job(api, retryable=False)

    # When: the user asks to retry.
    response = client.post(f"/api/v1/sync-jobs/{seeded.job_id}/retry")

    # Then: the contract's 409 explains why the button did nothing.
    assert response.status_code == status.HTTP_409_CONFLICT
    assert text_of(obj(body_of(response.text)["error"])["code"]) == "NO_RETRYABLE_TASKS"


async def test_retrying_an_unknown_job_is_reported_as_not_found(
    api: str,
    client: TestClient,
) -> None:
    # Given: an id that belongs to no job.
    assert api

    # When: a retry is requested.
    response = client.post(f"/api/v1/sync-jobs/{uuid4()}/retry")

    # Then: the client sees the contract's 404 envelope.
    assert response.status_code == status.HTTP_404_NOT_FOUND


async def test_the_status_response_carries_a_trace_id(
    api: str,
    client: TestClient,
) -> None:
    # Given: a job to poll.
    assert api
    seeded = await seed_failed_job(api, retryable=True)

    # When: the status is read.
    response = client.get(f"/api/v1/sync-jobs/{seeded.job_id}")

    # Then: the response can be tied back to the server's log line.
    assert response.headers["X-Request-ID"]
