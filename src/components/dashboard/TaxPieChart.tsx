'use client';

import { CategoryBreakdown, type CategoryDatum } from './CategoryBreakdown';

/** Taxes by category, as a ranked breakdown (the file keeps its widget name). */
export default function TaxPieChart({
    data,
    loading,
    taggedMode = false,
}: {
    data: CategoryDatum[];
    loading: boolean;
    /** True when tax accounts are identified via the "taxes" account tag. */
    taggedMode?: boolean;
}) {
    return (
        <CategoryBreakdown
            title="Taxes by category"
            data={data}
            loading={loading}
            emptyMessage="No taxes in this period."
            emptyHint={taggedMode
                ? 'No activity in accounts tagged "taxes" for this period.'
                : 'Tag expense accounts with the "taxes" tag (edit account, then Tags) to control exactly which accounts appear here.'}
        />
    );
}
