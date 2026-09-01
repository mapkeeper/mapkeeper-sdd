import pytest

from mapkeeper.services.pii_masking import mask_customer_pii


@pytest.mark.parametrize(
    "copy",
    [
        "항상 친절한 고객님을 맞이합니다.",
        "저희 매장을 찾아주시는 고객분들을 위해 준비했습니다.",
    ],
)
def test_ordinary_korean_words_before_customer_nouns_are_not_masked(copy: str) -> None:
    assert mask_customer_pii(copy) == copy


def test_redundant_mask_markers_after_public_business_values_are_removed() -> None:
    address = "서울특별시 관악구 시연로 12"
    phone = "02-000-0000"
    copy = f"주소: {address} ([MASKED_ADDRESS]) / 전화: {phone} ([MASKED_PHONE])"

    masked = mask_customer_pii(copy, (address, phone))

    assert masked == f"주소: {address} / 전화: {phone}"


def test_business_info_instruction_is_not_treated_as_a_customer_address() -> None:
    instruction = "문구에 매장 주소와 대표번호를 포함해 주세요."

    assert mask_customer_pii(instruction) == instruction
