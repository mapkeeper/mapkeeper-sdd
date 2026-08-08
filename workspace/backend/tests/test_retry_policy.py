"""T224: the retry policy itself, which needs no database."""

from datetime import timedelta

import pytest

from mapkeeper.services.retry import MAX_ATTEMPTS, backoff_delay


@pytest.mark.parametrize(("attempt", "seconds"), [(1, 2), (2, 4), (3, 8)])
def test_backoff_grows_with_each_attempt(attempt: int, seconds: int) -> None:
    # Given: the attempts a platform has already used.

    # When / Then: waiting doubles, so a struggling platform is not hammered.
    assert backoff_delay(attempt) == timedelta(seconds=seconds)


def test_the_contract_allows_at_most_three_attempts() -> None:
    # Given: the ceiling the API Contract fixes.

    # When / Then: a platform is never attempted a fourth time.
    assert MAX_ATTEMPTS == 3
