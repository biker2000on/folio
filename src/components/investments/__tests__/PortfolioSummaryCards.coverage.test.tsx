/**
 * The portfolio summary cards.
 *
 * Three numbers standing in for a whole portfolio is exactly where a partial
 * basis gets read as a complete one, so `totalCostBasisCoverage` is a REQUIRED
 * prop: a caller cannot render these cards without stating what the basis
 * behind them covers.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CostBasisCoverage } from '@/lib/commodities';

import { PortfolioSummaryCards } from '../PortfolioSummaryCards';

const PARTIAL: CostBasisCoverage = {
    status: 'partial',
    coveredShares: 250,
    uncoveredShares: 50,
    warnings: [],
};
const COMPLETE: CostBasisCoverage = { status: 'complete', coveredShares: 300 };

function cards(coverage: CostBasisCoverage) {
    return (
        <PortfolioSummaryCards
            totalValue={15_000}
            totalCostBasis={5_500}
            totalCostBasisCoverage={coverage}
            totalGainLoss={7_000}
            performancePercent={12.5}
            performanceMetric="twr"
        />
    );
}

describe('PortfolioSummaryCards — cost-basis coverage', () => {
    it('renames the gain card and caveats both figures under partial coverage', () => {
        render(cards(PARTIAL));

        // "Total Gain/Loss" would claim the whole portfolio; this is the gain
        // on the shares the basis covers.
        expect(screen.getAllByText('Total Covered Gain').length).toBeGreaterThan(0);
        expect(screen.queryByText('Total Gain/Loss')).toBeNull();

        // Both the basis and the gain carry the marker.
        const marks = screen.getAllByLabelText('Cost basis covers only part of this position');
        expect(marks.length).toBeGreaterThanOrEqual(2);
        fireEvent.click(marks[0]);
        expect(screen.getByText(/covers 250 of 300 shares/)).toBeTruthy();

        // And the slice is named without needing the tooltip at all, under
        // both the basis and the gain. One responsive card set serves every
        // screen size, so the phone — the device least able to hover — reads
        // the same always-visible caveat as the desktop.
        expect(screen.getAllByText('covered gain · 250 of 300 shares')).toHaveLength(2);
    });

    it('reads exactly as before when the basis covers every share', () => {
        render(cards(COMPLETE));

        expect(screen.getAllByText('Total Gain/Loss').length).toBeGreaterThan(0);
        expect(screen.queryByText('Total Covered Gain')).toBeNull();
        expect(screen.queryByLabelText('Cost basis covers only part of this position')).toBeNull();
        expect(screen.queryByText(/covered gain/)).toBeNull();
    });

    it('marks an unverified basis without renaming it a measured shortfall', () => {
        render(cards({ status: 'unknown', reason: 'Cost basis carry-over is off.' }));

        const marks = screen.getAllByLabelText('Cost-basis coverage is unverified');
        expect(marks.length).toBeGreaterThanOrEqual(2);
        expect(screen.getAllByText('basis coverage unverified')).toHaveLength(2);

        // "Covered Gain" would claim a measured slice. Under unknown coverage
        // the gain is the WHOLE position's and may be overstated by whatever
        // basis is missing, so the heading says exactly that.
        expect(screen.getAllByText('Total Gain (basis unverified)').length).toBeGreaterThan(0);
        expect(screen.queryByText('Total Covered Gain')).toBeNull();
        expect(screen.queryByText('Total Gain/Loss')).toBeNull();
    });
});

describe('PortfolioSummaryCards — every KPI drills down', () => {
    it('links each card to the view that explains its number', () => {
        render(
            <PortfolioSummaryCards
                totalValue={15_000}
                totalCostBasis={5_500}
                totalCostBasisCoverage={COMPLETE}
                totalGainLoss={7_000}
                performancePercent={12.5}
                performanceMetric="twr"
                cash={{ balance: 1_000, percent: 6.25 }}
            />
        );

        const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'));
        expect(hrefs).toEqual([
            '#holdings',
            '/investments?view=cash',
            '/reports/investment_lots',
            '/reports/investment_lots',
            '/investments?view=benchmark',
        ]);
    });

    it('lets a page point the cards somewhere else', () => {
        render(
            <PortfolioSummaryCards
                totalValue={15_000}
                totalCostBasis={5_500}
                totalCostBasisCoverage={COMPLETE}
                totalGainLoss={7_000}
                performancePercent={12.5}
                performanceMetric="mwr"
                links={{ performance: '#performance' }}
            />
        );

        // No cash card without cash data; the return card follows the override.
        expect(screen.getAllByRole('link')).toHaveLength(4);
        expect(screen.getByRole('link', { name: /Compare to indices/ }).getAttribute('href')).toBe('#performance');
    });
});
