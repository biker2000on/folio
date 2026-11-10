# Use Folio from Claude (MCP)

Folio includes a read-only [Model Context Protocol](https://modelcontextprotocol.io)
server. Connect Claude Code, Claude Desktop, or any other MCP client to it and ask
questions about your books in plain language: "what did I spend on groceries last
month?", "which subscriptions went up in price?", "how is the 2026 budget pacing?".

- **Endpoint:** `https://<your-folio-host>/api/mcp` (MCP Streamable HTTP, stateless,
  JSON responses).
- **Authentication:** a personal API token (`gcw_…`) in the `Authorization` header.
  Nothing else is accepted. Browser session cookies are rejected, even alongside a token.
- **Scope:** exactly one book, the one the token was created for.
- **Access:** read-only. No tool can create, change, or delete anything, so a
  read-only token is all you need.

## 1. Create a read-only token

1. Open the book you want Claude to see. Tokens belong to the book that is active
   when you create them.
2. Go to **Settings → API Tokens → Create token**.
3. Name it after the client (for example `Claude Code`), choose **Read-only**, pick
   the **Detail for AI clients** (Summary by default, see [Privacy](#privacy)), and pick
   an expiration.
4. Copy the `gcw_…` secret. It is shown once.

A token can never do more than you can: its access is capped at your own role for
the book, and it stops working as soon as you revoke it or your access to the book
is removed. See [API tokens](api-tokens.md) for the details.

## 2. Connect a client

### Claude Code (remote HTTP, recommended)

```bash
claude mcp add --transport http folio https://<your-folio-host>/api/mcp \
  --header "Authorization: Bearer gcw_..."
```

Add `--scope user` to make it available in every project. Check it with
`claude mcp list` or `/mcp` inside a session.

Typing the token into the command line leaves it in your shell history. To avoid
that, keep it in an environment variable and reference it from `.mcp.json` (Claude
Code expands `${VAR}` in that file):

```json
{
  "mcpServers": {
    "folio": {
      "type": "http",
      "url": "https://<your-folio-host>/api/mcp",
      "headers": { "Authorization": "Bearer ${FOLIO_TOKEN}" }
    }
  }
}
```

### Claude Desktop (stdio bridge)

Claude Desktop's local servers speak stdio, so use the bridge in
[`scripts/folio-mcp.mjs`](../scripts/folio-mcp.mjs). It has no dependencies (Node
18 or newer). Copy it anywhere, then add this to `claude_desktop_config.json`
(Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "folio": {
      "command": "node",
      "args": ["/path/to/folio-mcp.mjs"],
      "env": {
        "FOLIO_URL": "https://<your-folio-host>",
        "FOLIO_TOKEN": "gcw_..."
      }
    }
  }
}
```

Restart Claude Desktop. The bridge reads `FOLIO_URL` and `FOLIO_TOKEN` from its
environment only. Do not pass the token as a command-line argument: other local
processes can read command lines. The bridge refuses to send the token over plain
`http://` to anything other than `localhost` unless you set `FOLIO_ALLOW_HTTP=1`.

The same bridge works for any other stdio-only MCP client.

### Other clients

Any client that supports Streamable HTTP can connect directly: POST JSON-RPC to
`/api/mcp` with `Authorization: Bearer gcw_…`, `Content-Type: application/json`, and
`Accept: application/json, text/event-stream`. The server is stateless. It issues no
`Mcp-Session-Id`, opens no SSE stream, and answers `GET` with `405`.

```bash
curl -s https://<your-folio-host>/api/mcp \
  -H "Authorization: Bearer $FOLIO_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tools

All tools are annotated `readOnlyHint: true`. Every result is size-capped. Each tool
has its own row limit, and anything over roughly 200,000 characters is refused with a
request to narrow the query.

| Tool | What it returns |
| --- | --- |
| `list_accounts` | Chart of accounts with each account's own balance and its total including sub-accounts in the report currency. Filters: account types, hidden, zero balances, as-of date. |
| `account_balance_history` | Month-end balances of one account, with or without sub-accounts, for up to 60 months. |
| `search_transactions` | Transactions newest first, filtered by text (description, number, memo), date range, account (sub-accounts included), and amount range. At most 200. |
| `spending_by_category` | Spending per expense category for a date range, grouped at a chosen depth, converted to the report currency. |
| `income_vs_expense` | Monthly income, expenses, taxes, and net for up to 36 months, with the savings rate. |
| `net_worth` | Current assets, investments, liabilities, and net worth, plus month-end history. Reports holdings that could not be priced. |
| `budget_status` | Budgeted vs actual for the current period of a budget (by default the one covering today), with pacing. |
| `recurring_charges` | Detected subscriptions and other recurring charges: cadence, price changes, monthly cost, next expected date. |
| `investment_holdings` | Positions with shares, latest price, market value, cost basis, and unrealized gain, plus totals. |
| `upcoming_scheduled_transactions` | Scheduled-transaction occurrences due in the next N days. |
| `action_center_items` | Open items from the Financial Action Center (fix, decide, do), most important first. |

Accounts can be referenced by full path (`Expenses:Food:Groceries`), bare name, or
guid. An ambiguous name returns the candidates so the model can pick one.

### Signs and currency

GnuCash stores credits as negative numbers, so income, liabilities, and equity are
negative in the ledger. The summary tools (`list_accounts`, `account_balance_history`,
`spending_by_category`, `income_vs_expense`, `net_worth`, `budget_status`,
`recurring_charges`) flip those to their natural sign: income earned and debt owed are
positive. `search_transactions` and `upcoming_scheduled_transactions` keep raw
double-entry signs (positive = debit, negative = credit). Each tool's description
tells the model which convention it uses. Amounts are in the book's report currency
unless a field names another commodity, such as shares for an investment account.

## Privacy

An MCP client is somebody else's model, usually in the cloud. Folio's own screens can
swap placeholder tokens back into real names before you see them; an MCP client
cannot. So every tool result goes through Folio's AI privacy gate
(`src/lib/ai-privacy`) on the server before it leaves.

Each `tools/call` runs at the **stricter** of two settings:

| Your AI privacy mode (Settings → AI) | Token detail: Summary (default) | Token detail: Full detail |
| --- | --- | --- |
| Off | refused | refused |
| Summary only (default) | summary | summary |
| Full detail on my own hardware | summary | full |

- **Off.** Every `tools/call` returns an error result saying AI access is turned off
  in Settings. `tools/list` still works, so the client can show what exists.
- **Summary.** Names become placeholder tokens: `⟨A1⟩` an account, `⟨M1⟩` a payee,
  description or memo, `⟨H1⟩` a holding. Account paths keep their generic top level
  (`Expenses:⟨A2⟩:⟨A3⟩`). Money is rounded (to 5 under 100, to 10 under 1,000, to 100
  above). Dates become months (`YYYY-MM`). Counts, percentages, account types, currency
  codes and GUIDs are kept. Folio's own explanatory notes (sign conventions) stay as
  written, and free-text fields such as Action Center titles are scrubbed in place.
  Tool errors are scrubbed too, since they can echo an account name.
- **Full.** Results pass through unchanged. This needs both your AI privacy mode set
  to full detail and the token created with full detail. The "own hardware" endpoint
  flag in Settings → AI plays no part here: the MCP client is never that endpoint.

**Drilling into a token.** In summary mode the model can pass a token back as an
argument, for example `search_transactions { "text": "⟨M3⟩" }` or
`account_balance_history { "account": "Expenses:⟨A2⟩" }`. The server swaps exact tokens
for the real names before the arguments are validated and the tool runs, then scrubs
the answer again. A token the server never issued is refused with an error instead of
being searched for. The server's `instructions` explain all of this to the client.

Tokens live only in the Folio server's memory, per book. They stay stable across
calls, and are the same ones Folio's own AI features use, for as long as the server
keeps the map: it is dropped after 30 idle minutes and on restart. After that a
client gets "Unknown placeholder" and calls the listing tool again. With several app
replicas, each keeps its own map, so a token from one replica may be unknown to
another.

## Security notes

- **Least privilege.** Use a dedicated read-only token per client, with an
  expiration. Revoke it in Settings → API Tokens when you stop using that client.
  Revocation takes effect on the next request.
- **One book.** A token reaches only its own book. To query another book, create a
  token while that book is active and add a second server entry.
- **No cookies.** The endpoint authenticates the bearer token and nothing else. A
  request carrying a Folio session cookie is rejected with `401`, so a web page you
  visit cannot ride your browser session into it.
- **Your data goes to the model provider.** Tool results are sent to whichever model
  your client uses. By default that is a summary (placeholders, rounded amounts,
  months); with full detail it includes account names, payees, and exact amounts.
  Decide which is acceptable for the book before you connect it. See [Privacy](#privacy).
- **Keep the token out of history and process lists.** Prefer environment variables
  (`.mcp.json` `${VAR}` expansion, or the bridge's `FOLIO_TOKEN`) over pasting the token
  into commands.
- **Read-only, with one side effect.** Tools never change your books. Reading
  `action_center_items` may refresh the Action Center's cached item list when it is
  stale, exactly as opening the Action Center page does.
