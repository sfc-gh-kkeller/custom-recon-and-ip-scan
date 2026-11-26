# Custom Trust Scanner (Snowflake demo)

A Trust Center-style scanner built with plain Snowflake objects (not a Native App extension).

| Scanner | Detects |
|---|---|
| `RECON_SYSTEM_USER` | Service users (`TYPE` = SERVICE / LEGACY_SERVICE) running `SHOW`/`DESCRIBE`/metadata-view queries across many object types |
| `MULTI_IP_LOGIN` | Users with successful logins from many distinct IPs in the lookback window |

New findings are stored in `FINDINGS` and emailed via `SYSTEM$SEND_EMAIL`. A task runs the scan hourly.

## Deploy (Snowflake CLI)

1. Edit `sql/01_deploy.sql`: replace `<YOUR_DB>`, `<YOUR_WAREHOUSE>`, `<YOUR_VERIFIED_EMAIL>` (must be a verified user email in the account).
2. `snow sql -c <connection> -f sql/01_deploy.sql`
3. `snow sql -c <connection> -f sql/02_demo_run.sql` (run inside the `TRUST_SCANNER` schema)
4. Cleanup: `sql/99_teardown.sql`

Requires ACCOUNTADMIN (or equivalent) and `SNOWFLAKE.ACCOUNT_USAGE` access.

## Tuning
`SCANNER_CONFIG`: `LOOKBACK_HOURS` (24), `RECON_DISTINCT_MIN` (5), `IP_DISTINCT_MIN` (3).

## Limitations
`ACCOUNT_USAGE` latency: up to ~45 min (queries) / ~2 h (logins). Findings are not shown in the Trust Center UI.
Demo only; not a replacement for Snowflake Trust Center.
