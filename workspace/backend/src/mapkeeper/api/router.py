from typing import Final

from fastapi import APIRouter

from mapkeeper.api.routes import seo, store_change, sync

API_V1_PREFIX: Final = "/api/v1"

api_router = APIRouter(prefix=API_V1_PREFIX)
api_router.include_router(store_change.router)
api_router.include_router(seo.router)
api_router.include_router(sync.router)

__all__ = ["API_V1_PREFIX", "api_router"]
