"""
Unified deal serializer for all v2 services and endpoints.
Ensures every drawer has Opportunity name, Account, BU, Owner, Stage,
Approval status, Forecast category, Close Date, and ACV.
"""
from datetime import date, datetime
from typing import Any
from backend.models import Opportunity
from backend.services.scopes import ScopeService
from backend.constants import normalize_forecast_category, normalize_approval_status
from backend.utils.excel_parser import parse_excel_date


def is_deal_open(deal: dict | Opportunity) -> bool:
    """
    Unified check whether a deal is currently open.
    Matches admin logic (_is_open_deal in v2_delayed_service.py):
    - Sales Type = Renewals
    - Forecast Category != Closed
    - Stage not deleted, lost, closed lost, won & closed, or 9. won
    - Not deleted or lost
    - Probability below 100%
    """
    if isinstance(deal, dict):
        sales_type = deal.get("sales_type") or deal.get("type") or ""
        fc = deal.get("forecast_category") or ""
        stage = deal.get("stage_number") or deal.get("stage") or ""
        is_del = bool(deal.get("is_deleted_or_lost"))
        prob = deal.get("probability_pct") if deal.get("probability_pct") is not None else deal.get("probability")
    else:
        extra = getattr(deal, "extra_attributes", None) or {}
        sales_type = deal.sales_type or extra.get("Sales Type") or extra.get("Type") or ""
        fc = deal.forecast_category or extra.get("Forecast Category") or ""
        stage = deal.stage_number or extra.get("Stage Number") or extra.get("stage") or extra.get("Stage") or ""
        is_del = bool(deal.is_deleted_or_lost)
        prob = deal.probability_pct if deal.probability_pct is not None else extra.get("Probability (%)") or extra.get("probability")

    if str(sales_type or "").strip().lower() != "renewals":
        return False
    if str(fc or "").strip().lower() == "closed":
        return False
    stage_str = str(stage or "").strip().lower()
    if any(w in stage_str for w in ["delete", "lost", "closed lost", "won & closed", "9. won"]):
        return False
    if is_del:
        return False
    try:
        p = float(prob)
        if p >= 100.0:
            return False
    except (ValueError, TypeError):
        pass
    return True


def is_deal_closed(deal: dict | Opportunity) -> bool:
    """Returns True if the deal is not open."""
    return not is_deal_open(deal)


def is_deal_overdue(deal: dict | Opportunity, as_of: date | str) -> bool:
    """
    A deal is overdue only if:
    1. It is STILL OPEN (won/closed deals are never overdue).
    2. Its close_date has passed (< as_of).
    """
    if not is_deal_open(deal):
        return False

    ref_d = as_of if isinstance(as_of, date) else parse_excel_date(as_of)
    if not ref_d:
        return False

    if isinstance(deal, dict):
        cd_val = deal.get("close_date")
    else:
        cd_val = deal.close_date
    cd = cd_val if isinstance(cd_val, date) else parse_excel_date(cd_val)
    if not cd:
        return False
    return cd < ref_d


def get_deal_needs_review_reasons(deal: dict | Opportunity, as_of: date | str | None = None) -> list[str]:
    """
    Evaluates whether an opportunity requires review, aligned with admin V2DelayedService:
    1. Missing service dates (missing/invalid start or expiry date) -> "Missing dates"
    2. Non-positive or negative ACV (acv <= 0) -> "Negative ACV"
    3. Far ahead close date (close_date > 1 year after as_of year) -> "Far ahead close date"
    """
    reasons: list[str] = []
    if is_deal_missing_service_dates(deal):
        reasons.append("Missing dates")

    if isinstance(deal, dict):
        acv = float(deal.get("forecast_acv_amount") if deal.get("forecast_acv_amount") is not None else (deal.get("acv") or 0.0))
        cd_val = deal.get("close_date")
    else:
        acv = float(deal.forecast_acv_amount or 0.0)
        cd_val = deal.close_date

    if acv <= 0:
        reasons.append("Negative ACV")

    if as_of and cd_val:
        ref_d = as_of if isinstance(as_of, date) else parse_excel_date(as_of)
        cd = cd_val if isinstance(cd_val, date) else parse_excel_date(cd_val)
        if ref_d and cd and is_deal_open(deal):
            if cd.year >= ref_d.year + 2:
                reasons.append("Far ahead close date")

    return reasons


def is_deal_needs_review(deal: dict | Opportunity, as_of: date | str | None = None) -> bool:
    return len(get_deal_needs_review_reasons(deal, as_of)) > 0



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
        "sales_type": o.sales_type or raw_type,
        "probability_pct": o.probability_pct,
        "is_open": is_deal_open(o),
        "review_reasons": get_deal_needs_review_reasons(o),
    }
