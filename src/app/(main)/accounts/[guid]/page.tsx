'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { AccountLedgerView } from '@/components/AccountLedgerView';
import { DATA_SURFACE_MAX_WIDTH } from '@/components/ui/layout-widths';

function AccountPageContent() {
    const params = useParams();
    return <AccountLedgerView guid={params.guid as string} />;
}

export default function AccountPage() {
    return (
        <Suspense fallback={
            <div className={`mx-auto w-full ${DATA_SURFACE_MAX_WIDTH} space-y-4`}>
                <div className="h-4 w-48 rounded-sm bg-surface" />
                <div className="h-8 w-72 rounded-sm bg-surface" />
                <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-surface p-12">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    <span className="text-sm text-foreground-secondary">Loading…</span>
                </div>
            </div>
        }>
            <AccountPageContent />
        </Suspense>
    );
}
