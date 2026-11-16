'use client';

import { CategoryBreakdown, type CategoryDatum } from './CategoryBreakdown';

/** Income by category, as a ranked breakdown (the file keeps its widget name). */
export default function IncomePieChart({ data, loading }: { data: CategoryDatum[]; loading: boolean }) {
    return (
        <CategoryBreakdown
            title="Income by category"
            data={data}
            loading={loading}
            emptyMessage="No income in this period."
        />
    );
}
