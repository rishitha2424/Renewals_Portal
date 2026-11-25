"""
Unified deal serializer for all v2 services and endpoints.
Ensures every drawer has Opportunity name, Account, BU, Owner, Stage,
Approval status, Forecast category, Close Date, and ACV.
"""
from typing import Any
from backend.models import Opportunity
from backend.services.scopes import ScopeService
from backend.constants import normalize_forecast_category, normalize_approval_status
from backend.utils.excel_parser import parse_excel_date


def extract_deal_service_dates(extra: dict) -> tuple[str | None, str | None]:
    """
    Extract normalized ISO YYYY-MM-DD service start and expiry dates from extra_attributes.
    Returns (service_start_date_iso, service_expiry_date_iso).
    """
    if not extra:
        return None, None
    raw_start = (
        extra.get("Service Start Date")
        or extra.get("service_start_date")
        or extra.get("Service Start date")
    )
    raw_expiry = (
        extra.get("Service Expiry date")
        or extra.get("Service End Date")
        or extra.get("Service Expiry Date")
        or extra.get("service_expiry_date")
        or extra.get("service_end_date")
    )
    start_d = parse_excel_date(raw_start)
    expiry_d = parse_excel_date(raw_expiry)
    return (
        start_d.isoformat() if start_d else None,
        expiry_d.isoformat() if expiry_d else None,
    )


def is_deal_missing_service_dates(deal: dict | Opportunity) -> bool:
    """
    Returns True if a deal is missing a valid service start date OR service expiry date.
    Shared function used consistently across all KAM and Admin pages.
    """
    if isinstance(deal, dict):
        s_start = deal.get("service_start_date")
        s_exp = deal.get("service_expiry_date") or deal.get("service_end_date")
        if s_start and s_exp:
            s_s = str(s_start).strip()
            s_e = str(s_exp).strip()
            if len(s_s) >= 10 and len(s_e) >= 10 and s_s != "00:00:00" and s_e != "00:00:00":
                return False
        extra = deal.get("extra_attributes") or deal
        s_start_iso, s_exp_iso = extract_deal_service_dates(extra)
        return not bool(s_start_iso and s_exp_iso)
    else:
        extra = getattr(deal, "extra_attributes", None) or {}
        s_start_iso, s_exp_iso = extract_deal_service_dates(extra)
        return not bool(s_start_iso and s_exp_iso)


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

    country = o.country_territory or extra.get("Country/Territory") or extra.get("Country") or extra.get("Country / Territory") or ""

    s_start, s_exp = extract_deal_service_dates(extra)

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
        "country_territory": country,
        "country": country,
        "business_unit_primary": bu,
        "business_unit": bu,
        "business_unit_raw": o.business_unit_raw or bu,
        "approval_status": st_display,
        "type": raw_type,
        "type_code": type_code,
        "close_date": close_d,
        "owner": owner,
        "opportunity_owner": owner,
        "stage": stage,
        "stage_number": stage,
        "service_start_date": s_start,
        "service_expiry_date": s_exp,
        "service_end_date": s_exp,
    }
