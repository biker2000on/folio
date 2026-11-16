'use client';

import { CategoryBreakdown, type CategoryDatum } from './CategoryBreakdown';

/** Expenses by category, as a ranked breakdown (the file keeps its widget name). */
export default function ExpensePieChart({ data, loading }: { data: CategoryDatum[]; loading: boolean }) {
    return (
        <CategoryBreakdown
            title="Expenses by category"
            data={data}
            loading={loading}
            emptyMessage="No expenses in this period."
        />
    );
}
