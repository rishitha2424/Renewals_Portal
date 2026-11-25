"""
Shared router dependencies for v2 endpoints (Round 18).
Injects user context and restricts KAMs to their own deals.
"""
from typing import Optional, List
from fastapi import Query, Depends
from backend.services.scopes import FilterSpec
from backend.services.context import get_user_context, UserContext


def get_filter_spec(
    as_of: Optional[str] = Query(None),
    compare: Optional[str] = Query("yesterday"),
    period: Optional[str] = Query("current_quarter"),
    sales_types: Optional[List[str]] = Query(None),
    regions: Optional[List[str]] = Query(None),
    business_units: Optional[List[str]] = Query(None),
    forecast_categories: Optional[List[str]] = Query(None),
    approval_statuses: Optional[List[str]] = Query(None),
    types: Optional[List[str]] = Query(None),
    types_bracket: Optional[List[str]] = Query(None, alias="types[]"),
    include_deleted_lost: Optional[bool] = Query(None),
    exclude_deleted_lost: bool = Query(False),
    exclude_deleted: bool = Query(False),
    ctx: UserContext = Depends(get_user_context),
) -> FilterSpec:
    idl = False
    if include_deleted_lost is not None:
        idl = bool(include_deleted_lost)
    elif exclude_deleted or exclude_deleted_lost:
        idl = False

    eff_types = types if types is not None else types_bracket

    allowed_owners = ctx.all_owner_names if (ctx and ctx.is_kam) else None

    return FilterSpec.from_params(
        as_of=as_of,
        compare=compare,
        period=period,
        sales_types=sales_types,
        regions=regions,
        business_units=business_units,
        forecast_categories=forecast_categories,
        approval_statuses=approval_statuses,
        types=eff_types,
        include_deleted_lost=idl,
        allowed_owners=allowed_owners,
        user_context=ctx,
    )
