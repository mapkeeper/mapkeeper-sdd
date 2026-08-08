"""T239: UC1 and UC2 happy paths through the HTTP API."""

from collections.abc import AsyncGenerator, Callable
from typing import Final
from uuid import UUID

import pytest
import pytest_asyncio
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from mapkeeper.adapters.base import (
    PlatformAdapter,
    PlatformError,
    PlatformSyncError,
    SyncRequest,
)
from mapkeeper.adapters.registry import AcceptingAdapter
from mapkeeper.core.config import get_settings
from mapkeeper.core.json_types import JsonObject
from mapkeeper.db.session import get_engine, get_session_factory
from mapkeeper.main import app
from mapkeeper.models import Platform, PlatformErrorCode
from tests.jsonassert import arr, body_of, obj, text_of

from .factories import make_store_profile

pytestmark = pytest.mark.asyncio

ACTOR_ID: Final = "99999999-9999-4999-8999-999999999999"


@pytest_asyncio.fixture
async def api_database(
    integration_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[tuple[str, list[UUID]], None]:
    """Configure the API against the disposable database and clean test profiles."""
    monkeypatch.setenv("DATABASE_URL", integration_database_url)
    monkeypatch.setenv("MVP_ACTOR_ID", ACTOR_ID)
    get_settings.cache_clear()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    engine = create_async_engine(integration_database_url, poolclass=NullPool)
    monkeypatch.setattr("mapkeeper.db.session.get_engine", lambda: engine)
    created_profiles: list[UUID] = []
    try:
        yield integration_database_url, created_profiles
    finally:
        await _delete_profiles(integration_database_url, created_profiles)
        await engine.dispose()
        get_settings.cache_clear()
        get_session_factory.cache_clear()
        get_engine.cache_clear()


@pytest.fixture
def client() -> TestClient:
    """Return an HTTP client without running the application lifespan."""
    return TestClient(app)


async def _create_profile(url: str, created_profiles: list[UUID]) -> UUID:
    engine = create_async_engine(url, poolclass=NullPool)
    factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        async with factory() as session, session.begin():
            profile = await make_store_profile(session)
            created_profiles.append(profile.id)
            return profile.id
    finally:
        await engine.dispose()


async def _delete_profiles(url: str, profile_ids: list[UUID]) -> None:
    if not profile_ids:
        return
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.begin() as connection:
            _ = await connection.execute(
                text("DELETE FROM sync_job WHERE store_profile_id = ANY(:ids)"),
                {"ids": profile_ids},
            )
            _ = await connection.execute(
                text("DELETE FROM store_profile WHERE id = ANY(:ids)"),
                {"ids": profile_ids},
            )
    finally:
        await engine.dispose()


async def test_uc1_create_approve_and_poll_flow(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
) -> None:
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)

    # Given: a store profile and a natural-language business-hours request.
    response = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": "영업시간을 오후 8시까지로 바꿔줘",
            "locale": "ko-KR",
        },
    )

    # When: the proposal is created and approved.
    assert response.status_code == status.HTTP_201_CREATED
    proposal_id = text_of(obj(body_of(response.text)["data"])["proposalId"])
    approval = client.post(
        f"/api/v1/store-change-proposals/{proposal_id}/approve",
        headers={"Idempotency-Key": "e2e-uc1-approval"},
    )

    # Then: the committed synchronization can be polled successfully.
    assert approval.status_code == status.HTTP_202_ACCEPTED
    approval_data = obj(body_of(approval.text)["data"])
    sync_job_id = text_of(approval_data["syncJobId"])
    status_response = client.get(f"/api/v1/sync-jobs/{sync_job_id}")
    status_data = obj(body_of(status_response.text)["data"])
    assert status_response.status_code == status.HTTP_200_OK
    assert text_of(status_data["status"]) == "SUCCESS"
    assert all(
        text_of(obj(task)["status"]) == "SUCCESS" for task in arr(status_data["platformTasks"])
    )


async def test_uc2_create_approve_and_poll_flow(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
) -> None:
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)

    # Given: a store profile and one common SEO brief.
    response = client.post(
        "/api/v1/seo/generations",
        json={
            "storeProfileId": str(profile_id),
            "briefText": "가족 외식에 어울리는 깊은 국물 맛을 소개해줘",
            "seedKeywords": ["만두전골", "가족외식"],
        },
    )

    # When: the complete three-platform generation is approved.
    assert response.status_code == status.HTTP_201_CREATED
    generation_data = obj(body_of(response.text)["data"])
    assert len(arr(generation_data["drafts"])) == 3
    generation_id = text_of(generation_data["generationId"])
    approval = client.post(
        f"/api/v1/seo/generations/{generation_id}/approve",
        headers={"Idempotency-Key": "e2e-uc2-approval"},
    )

    # Then: all three generated platforms reach a successful SyncJob state.
    assert approval.status_code == status.HTTP_202_ACCEPTED
    sync_job_id = text_of(obj(body_of(approval.text)["data"])["syncJobId"])
    status_response = client.get(f"/api/v1/sync-jobs/{sync_job_id}")
    status_data = obj(body_of(status_response.text)["data"])
    assert status_response.status_code == status.HTTP_200_OK
    assert text_of(status_data["status"]) == "SUCCESS"
    assert len(arr(status_data["platformTasks"])) == 3


class FailingAdapter:
    """Adapter that reports a platform refusing or failing the update."""

    def __init__(self, platform: Platform, code: PlatformErrorCode) -> None:
        """Fail every request with the given normalized code."""
        self.platform: Platform = platform
        self._code: PlatformErrorCode = code

    async def publish(self, request: SyncRequest) -> None:
        """Refuse the update."""
        _ = request
        raise PlatformSyncError(PlatformError(code=self._code, platform=self.platform))


def _adapter_factory(
    failures: dict[Platform, PlatformErrorCode],
) -> Callable[[Platform], PlatformAdapter]:
    def choose(platform: Platform) -> PlatformAdapter:
        code = failures.get(platform)
        if code is None:
            return AcceptingAdapter(platform)
        return FailingAdapter(platform, code)

    return choose


async def _approved_uc1_job(
    client: TestClient,
    database_url: str,
    created_profiles: list[UUID],
    key: str,
) -> str:
    profile_id = await _create_profile(database_url, created_profiles)
    created = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": "영업시간을 오후 8시까지로 바꿔줘",
            "locale": "ko-KR",
        },
    )
    assert created.status_code == status.HTTP_201_CREATED
    proposal_id = text_of(obj(body_of(created.text)["data"])["proposalId"])
    approval = client.post(
        f"/api/v1/store-change-proposals/{proposal_id}/approve",
        headers={"Idempotency-Key": key},
    )
    assert approval.status_code == status.HTTP_202_ACCEPTED
    return text_of(obj(body_of(approval.text)["data"])["syncJobId"])


def _task_by_platform(client: TestClient, sync_job_id: str) -> tuple[str, dict[str, JsonObject]]:
    response = client.get(f"/api/v1/sync-jobs/{sync_job_id}")
    assert response.status_code == status.HTTP_200_OK
    data = obj(body_of(response.text)["data"])
    tasks = {text_of(obj(task)["platform"]): obj(task) for task in arr(data["platformTasks"])}
    return text_of(data["status"]), tasks


async def test_one_failing_platform_reports_partial_success(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: Naver refuses the update while the other platforms accept it.
    database_url, created_profiles = api_database
    monkeypatch.setattr(
        "mapkeeper.services.sync_runner.get_adapter",
        _adapter_factory({Platform.NAVER: PlatformErrorCode.API_TIMEOUT}),
    )

    # When: a proposal is approved and the job is polled.
    sync_job_id = await _approved_uc1_job(client, database_url, created_profiles, "e2e-partial")
    job_status, tasks = _task_by_platform(client, sync_job_id)

    # Then: reading the status still succeeds, and only Naver reports a failure.
    assert job_status == "PARTIAL_SUCCESS"
    assert text_of(tasks["google"]["status"]) == "SUCCESS"
    assert text_of(tasks["kakao"]["status"]) == "SUCCESS"
    assert text_of(tasks["naver"]["status"]) == "FAILED"
    naver_error = obj(tasks["naver"]["error"])
    assert text_of(naver_error["code"]) == PlatformErrorCode.API_TIMEOUT.value
    assert naver_error["retryable"] is True


async def test_every_platform_failing_reports_a_failed_job(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: every platform rejects the update for a reason that will not change.
    database_url, created_profiles = api_database
    monkeypatch.setattr(
        "mapkeeper.services.sync_runner.get_adapter",
        _adapter_factory(dict.fromkeys(Platform, PlatformErrorCode.PERMISSION_DENIED)),
    )

    # When: a proposal is approved and the job is polled.
    sync_job_id = await _approved_uc1_job(client, database_url, created_profiles, "e2e-failed")
    job_status, tasks = _task_by_platform(client, sync_job_id)

    # Then: the job is reported as fully failed with nothing worth retrying.
    assert job_status == "FAILED"
    assert all(text_of(task["status"]) == "FAILED" for task in tasks.values())
    assert all(obj(task["error"])["retryable"] is False for task in tasks.values())

    retry = client.post(f"/api/v1/sync-jobs/{sync_job_id}/retry")
    assert retry.status_code == status.HTTP_409_CONFLICT
    assert text_of(obj(body_of(retry.text)["error"])["code"]) == "NO_RETRYABLE_TASKS"


async def test_retrying_a_partial_failure_recovers_the_job(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: a job left partially successful by a transient Naver failure.
    database_url, created_profiles = api_database
    monkeypatch.setattr(
        "mapkeeper.services.sync_runner.get_adapter",
        _adapter_factory({Platform.NAVER: PlatformErrorCode.PLATFORM_SERVER_ERROR}),
    )
    sync_job_id = await _approved_uc1_job(client, database_url, created_profiles, "e2e-retry")
    assert _task_by_platform(client, sync_job_id)[0] == "PARTIAL_SUCCESS"

    # When: the platform recovers and the user retries.
    monkeypatch.setattr("mapkeeper.services.sync_runner.get_adapter", _adapter_factory({}))
    retry = client.post(f"/api/v1/sync-jobs/{sync_job_id}/retry")

    # Then: only Naver runs again, and the job ends up fully successful.
    assert retry.status_code == status.HTTP_202_ACCEPTED
    retry_data = obj(body_of(retry.text)["data"])
    assert [text_of(item) for item in arr(retry_data["retryingPlatforms"])] == ["naver"]
    job_status, tasks = _task_by_platform(client, sync_job_id)
    assert job_status == "SUCCESS"
    assert tasks["naver"]["attemptCount"] == 2
    assert tasks["google"]["attemptCount"] == 1
