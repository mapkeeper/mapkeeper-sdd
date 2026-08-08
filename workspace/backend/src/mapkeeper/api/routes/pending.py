"""Placeholder behaviour for endpoints whose contract is fixed but whose logic is not built.

Every route in this package is declared so the OpenAPI document carries the full v0.2
contract. The bodies arrive in T227~T229 (UC1), T232~T234 (UC2) and T225 (status and
retry); until then a call reports 501 instead of pretending to succeed.
"""

from typing import Never

from mapkeeper.core.errors import NotImplementedYetError


def not_implemented(*_contract_arguments: object) -> Never:
    """Reject a call to a route that only exists to publish its contract.

    The route's declared parameters are passed in and discarded so the published
    contract stays complete while the handler body is still missing.
    """
    raise NotImplementedYetError
