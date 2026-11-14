/**
 * Central dictionary of metric, status, category, and tile definitions.
 * All one-line plain definitions across Horizon live here for consistency.
 */

export const DEFINITIONS: Record<string, string> = {
  // Common / Global
  closed_forecast: 'Forecast category Closed = deal marked as closed in the forecast.',
  won_closed_stage: 'Sales stage, not the forecast category.',
  not_submitted: 'Not submitted = the deal has not been sent for approval yet (approval status blank).',
  newly_in_period: 'Deal was not in this period in the earlier snapshot.',

  // Overview Tiles
  total_acv: 'Total Annual Contract Value across all active renewal deals in the selected period.',
  coverage: 'Combined percentage of Total ACV that is in Commit or Best Case forecast categories.',
  closed_tile: 'Deals that have successfully reached Closed status in this period.',
  commit_tile: 'Deals expected to close with high confidence within the current period.',
  best_case_tile: 'Deals with strong potential that may close if key conditions are met.',
  pipeline_tile: 'Early-stage renewal deals being actively qualified and negotiated.',
  not_yet_proposed_tile: 'Active deals in scope that do not have a forecast category assigned.',

  // Overview Needs Attention
  proposal_pending: 'Deals in this period with no proposal status or opportunity approval recorded.',
  delayed_renewals: 'Deals whose service start date has passed without closing, requiring immediate action.',
  slippage: 'Deals whose expected close date shifted into the next fiscal year.',
  jan_1st_renewals: 'Renewals scheduled to take effect on the upcoming January 1st cycle.',

  // Approvals Page Tiles
  approvals_approved: 'Deals that have obtained full internal Opportunity Approval.',
  approvals_pending: 'Deals submitted for approval that are actively waiting on decision makers.',
  approvals_not_submitted: 'Deals that have not yet been submitted for internal approval.',
  approvals_total: 'Total deals and combined ACV evaluated for approval in this period.',

  // Regions & BU Tiles
  region_total: 'Total renewal ACV and deal count for the selected geographic region.',
  region_past_close: 'Deals in this region whose close date has already passed without closing.',
  bu_total: 'Total renewal ACV and deal count for this business unit.',
}

export function getDefinition(key: string, fallback = ''): string {
  return DEFINITIONS[key] || fallback
}
