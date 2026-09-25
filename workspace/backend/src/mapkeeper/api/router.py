from typing import Final

from fastapi import APIRouter, Depends

from mapkeeper.api.auth import get_current_actor
from mapkeeper.api.routes import review, seo, store_change, sync

API_V1_PREFIX: Final = "/api/v1"

api_router = APIRouter(prefix=API_V1_PREFIX, dependencies=[Depends(get_current_actor)])
api_router.include_router(store_change.router)
api_router.include_router(seo.router)
api_router.include_router(sync.router)
api_router.include_router(review.router)

__all__ = ["API_V1_PREFIX", "api_router"]
