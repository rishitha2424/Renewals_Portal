import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DealListModal from './DealListModal'

describe('DealListModal', () => {
  const mockDeals = [
    {
      id: '1',
      opportunity_id_18: 'OPP1',
      opportunity_name: 'Deal A',
      account_name: 'Acme',
      forecast_category: 'Commit',
      forecast_acv_amount: 1000,
      approval_status: 'Approved',
    },
    {
      id: '2',
      opportunity_id_18: 'OPP2',
      opportunity_name: 'Deal B',
      account_name: 'Globex',
      forecast_category: 'Best Case',
      forecast_acv_amount: 500,
      approval_status: 'Pending Approval',
    }
  ]

  it('filters deals by forecast category', () => {
    render(<DealListModal title="Test Modal" deals={mockDeals} onSelectOpp={vi.fn()} onClose={vi.fn()} />)
    
    // Initially shows both
    expect(screen.getByText('Deal A')).toBeDefined()
    expect(screen.getByText('Deal B')).toBeDefined()
    expect(screen.getByText(/Showing 2 deals/)).toBeDefined()

    // Filter by Commit
    const fcSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(fcSelect, { target: { value: 'Commit' } })

    // Now only shows Deal A
    expect(screen.queryByText('Deal B')).toBeNull()
    expect(screen.getByText(/Showing 1 deal/)).toBeDefined()
  })

  it('filters deals by stage', () => {
    const dealsWithStage = [
      {
        id: '1',
        opportunity_id_18: 'OPP1',
        opportunity_name: 'Deal A',
        account_name: 'Acme',
        forecast_category: 'Commit',
        forecast_acv_amount: 1000,
        approval_status: 'Approved',
        stage: '4. Develop Solution',
        owner: 'Alice Smith',
      },
      {
        id: '2',
        opportunity_id_18: 'OPP2',
        opportunity_name: 'Deal B',
        account_name: 'Globex',
        forecast_category: 'Best Case',
        forecast_acv_amount: 500,
        approval_status: 'Pending Approval',
        stage: '6. Secure Agreement',
        owner: 'Bob Jones',
      }
    ]

    render(<DealListModal title="Test Modal" deals={dealsWithStage} onSelectOpp={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getAllByText('4. Develop Solution').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('6. Secure Agreement').length).toBeGreaterThanOrEqual(1)

    // Stage dropdown is the 3rd combobox (FC, Status, Stage, Region, BU)
    const stageSelect = screen.getAllByRole('combobox')[2]
    fireEvent.change(stageSelect, { target: { value: '4. Develop Solution' } })

    expect(screen.getByText('Deal A')).toBeDefined()
    expect(screen.queryByText('Deal B')).toBeNull()
  })
})
