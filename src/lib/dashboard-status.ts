/**
 * Shape of GET /api/dashboard/status. Kept in a file with no imports so the
 * client widgets can share it with the route without reaching server code.
 */

export interface DashboardStatusAccount {
    guid: string;
    name: string;
    balance: number;
}

export interface DashboardStatus {
    /** How current the data behind the dashboard is. Null means "not known". */
    freshness: {
        latestPriceDate: string | null;
        lastBankSyncAt: string | null;
        reconciledThrough: string | null;
    };
    /** Balances in the book's base currency; other-currency accounts are counted, not summed. */
    accounts: {
        cash: DashboardStatusAccount[];
        cashTotal: number;
        credit: DashboardStatusAccount[];
        /** Amount owed on credit accounts, as a positive number. */
        creditOwed: number;
        otherCurrencyCount: number;
    };
    recent: {
        transactions: Array<{
            guid: string;
            date: string;
            description: string;
            amount: number;
            account: string | null;
            imported: boolean;
            reviewed: boolean;
        }>;
        /** Imported transactions nobody has marked reviewed. */
        unreviewedCount: number;
    };
}
