"""T239: UC1 and UC2 happy paths through the HTTP API."""

from collections.abc import AsyncGenerator, Callable
from datetime import timedelta
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
from mapkeeper.adapters.gemini_proposal import today_in_seoul
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


COMPOUND_SENTENCE: Final = (
    "다음 주 월요일 하루 임시 휴무이고 영업시간은 오전 10시부터 오후 9시까지입니다"
)


def _next_monday() -> str:
    today = today_in_seoul()
    return (today - timedelta(days=today.weekday()) + timedelta(days=7)).isoformat()


@pytest.mark.parametrize(
    "recognized_text",
    [
        COMPOUND_SENTENCE,
        f"고객 홍길동님 010-1234-5678 문의가 있었고 {COMPOUND_SENTENCE}",
    ],
)
async def test_uc1_a_compound_sentence_keeps_both_requests(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
    recognized_text: str,
) -> None:
    """One sentence naming two fields must propose both, not silently drop one.

    The final gate reproduced the loss here, through the real API: the hours were
    proposed and the closure came back only as an unmapped notice, so the owner
    had to say the same thing twice to get a day off.
    """
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)

    # Given / When: the owner states a closure and a business day in one breath.
    response = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": recognized_text,
            "locale": "ko-KR",
        },
    )

    # Then: both changes are in the proposal and nothing is reported as dropped.
    assert response.status_code == status.HTTP_201_CREATED
    data = obj(body_of(response.text)["data"])
    changes = {text_of(obj(change)["field"]): obj(change) for change in arr(data["changes"])}
    assert set(changes) == {"businessHours", "temporaryClosure"}
    hours = obj(changes["businessHours"]["proposedValue"])
    assert text_of(hours["open"]) == "10:00"
    assert text_of(hours["close"]) == "21:00"
    closure = obj(changes["temporaryClosure"]["proposedValue"])
    assert text_of(closure["startDate"]) == _next_monday()
    assert text_of(closure["endDate"]) == _next_monday()
    assert arr(data["unmappedRequests"]) == []

    # And: the customer's name never reaches the stored sentence.
    assert "홍길동" not in text_of(data["recognizedTextMasked"])


async def test_uc1_a_single_field_sentence_still_proposes_only_that_field(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
) -> None:
    """The merge must not invent a second change for an ordinary request."""
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)

    response = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": "내일 하루 쉽니다",
            "locale": "ko-KR",
        },
    )

    assert response.status_code == status.HTTP_201_CREATED
    data = obj(body_of(response.text)["data"])
    assert [text_of(obj(change)["field"]) for change in arr(data["changes"])] == [
        "temporaryClosure"
    ]
    assert arr(data["unmappedRequests"]) == []


async def test_uc1_an_unsupported_sentence_is_still_refused(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
) -> None:
    """A sentence naming none of the four fields must not become a proposal."""
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)

    response = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": "오늘 날씨 어때?",
            "locale": "ko-KR",
        },
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def _tomorrow() -> str:
    return (today_in_seoul() + timedelta(days=1)).isoformat()


def _next_weekday(weekday: int) -> str:
    today = today_in_seoul()
    return (today - timedelta(days=today.weekday()) + timedelta(days=7 + weekday)).isoformat()


async def test_uc1_a_relative_day_off_is_structured_as_an_exact_date(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
) -> None:
    """T256: "내일" is resolved against today rather than sent back to be re-said."""
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)

    response = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": "내일 하루 쉽니다",
            "locale": "ko-KR",
        },
    )

    assert response.status_code == status.HTTP_201_CREATED
    data = obj(body_of(response.text)["data"])
    (change,) = arr(data["changes"])
    closure = obj(obj(change)["proposedValue"])
    assert text_of(closure["startDate"]) == _tomorrow()
    assert text_of(closure["endDate"]) == _tomorrow()


async def test_uc1_a_stated_period_structures_both_its_ends(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
) -> None:
    """T256: a range names two days and the proposal has to carry both.

    "다음 주 월요일부터 수요일까지" was refused outright before, so the owner could
    only ask for a period one day at a time.
    """
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)

    response = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": "다음 주 월요일부터 수요일까지 쉽니다",
            "locale": "ko-KR",
        },
    )

    assert response.status_code == status.HTTP_201_CREATED
    data = obj(body_of(response.text)["data"])
    (change,) = arr(data["changes"])
    assert text_of(obj(change)["field"]) == "temporaryClosure"
    closure = obj(obj(change)["proposedValue"])
    assert text_of(closure["startDate"]) == _next_weekday(0)
    assert text_of(closure["endDate"]) == _next_weekday(2)
    assert arr(data["unmappedRequests"]) == []


async def test_uc1_a_compound_closure_and_parking_becomes_two_changes(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
) -> None:
    """T256: both halves of one sentence become their own change.

    The parking half used to survive only as an unmapped notice, which meant the
    owner had to say it again on its own before it could ever be approved.
    """
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)

    response = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": "9월 1일은 임시 휴무이고 주차는 불가능합니다",
            "locale": "ko-KR",
        },
    )

    assert response.status_code == status.HTTP_201_CREATED
    data = obj(body_of(response.text)["data"])
    changes = {text_of(obj(change)["field"]): obj(change) for change in arr(data["changes"])}
    assert set(changes) == {"temporaryClosure", "parkingInfo"}
    closure = obj(changes["temporaryClosure"]["proposedValue"])
    assert text_of(closure["startDate"]).endswith("-09-01")
    assert text_of(closure["endDate"]).endswith("-09-01")
    assert text_of(changes["parkingInfo"]["proposedValue"]) == "주차 불가"
    assert arr(data["unmappedRequests"]) == []


async def test_uc1_an_ambiguous_time_names_its_cause_and_a_way_to_retry(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
) -> None:
    """T256: an unreadable sentence must not be a dead end.

    "오후에 문을 닫습니다" names a time of day and no hour. The refusal has to say
    which of those is missing, offer a sentence that works, and hand the owner's
    own words back so the screen can put them in the retry box.
    """
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)
    sentence = "오후에 문을 닫습니다"

    response = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": sentence,
            "locale": "ko-KR",
        },
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    error = obj(body_of(response.text)["error"])
    assert text_of(error["code"]) == "VALIDATION_ERROR"
    failure = obj(error["failure"])
    assert text_of(failure["reason"]) == "AMBIGUOUS_TIME"
    assert text_of(failure["message"]).strip() != ""
    assert text_of(failure["guidance"]).strip() != ""
    assert text_of(failure["retry"]).strip() != ""
    assert arr(failure["examples"]) != []
    # The sentence survives the refusal so the screen can offer it back.
    assert text_of(failure["recognizedTextMasked"]) == sentence


async def test_uc1_an_unreadable_period_is_refused_rather_than_halved(
    api_database: tuple[str, list[UUID]],
    client: TestClient,
) -> None:
    """T256: a range with one unreadable end is named, never quietly shortened."""
    database_url, created_profiles = api_database
    profile_id = await _create_profile(database_url, created_profiles)

    response = client.post(
        "/api/v1/store-change-proposals",
        json={
            "storeProfileId": str(profile_id),
            "recognizedText": "9월 1일부터 나중까지 쉽니다",
            "locale": "ko-KR",
        },
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    failure = obj(obj(body_of(response.text)["error"])["failure"])
    assert text_of(failure["reason"]) == "UNREADABLE_DATE_RANGE"
