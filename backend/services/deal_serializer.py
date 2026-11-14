"""
Unified deal serializer for all v2 services and endpoints.
Ensures every drawer has Opportunity name, Account, BU, Owner, Stage,
Approval status, Forecast category, Close Date, and ACV.
"""
from typing import Any
from backend.models import Opportunity
from backend.services.scopes import ScopeService
from backend.constants import normalize_forecast_category, normalize_approval_status


def serialize_opportunity(o: Opportunity) -> dict[str, Any]:
    extra = o.extra_attributes or {}
    raw_type = extra.get("Type") or extra.get("type") or o.sales_type or ""
    type_code = ScopeService.extract_type_code(raw_type)

    stage = o.stage_number or extra.get("Stage Number") or extra.get("Stage") or ""
    owner = o.opportunity_owner or extra.get("Opportunity Owner") or extra.get("Owner") or ""

    close_d = None
    if o.close_date:
        close_d = o.close_date.isoformat() if hasattr(o.close_date, "isoformat") else str(o.close_date)[:10]

    fc_display = normalize_forecast_category(o.forecast_category)
    st_display = normalize_approval_status(o.approval_status)

    bu = o.business_unit_primary or ""
    if not bu or bu.lower() in ("nan", "none", ""):
        bu = "Unassigned"

    reg = o.revised_sub_region or o.sub_region or ""
    if not reg or reg.lower() in ("nan", "none", ""):
        reg = "Other / Unmapped"

    return {
        "id": o.opportunity_id_18 or o.id,
        "opportunity_id_18": o.opportunity_id_18,
        "opportunity_name": o.opportunity_name or "",
        "account_name": o.account_name or "",
        "forecast_category": fc_display,
        "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
        "acv": float(o.forecast_acv_amount or 0.0),
        "sub_region": reg,
        "region": reg,
        "business_unit_primary": bu,
        "business_unit": bu,
        "approval_status": st_display,
        "type": raw_type,
        "type_code": type_code,
        "close_date": close_d,
        "owner": owner,
        "opportunity_owner": owner,
        "stage": stage,
        "stage_number": stage,
        "service_start_date": extra.get("Service Start Date"),
        "service_expiry_date": extra.get("Service Expiry date") or extra.get("Service End Date") or extra.get("Service Expiry Date"),
    }
