# Custom Trust Scanner (Snowflake demo)

A Trust Center-style scanner built with plain Snowflake objects (not a Native App extension).

| Scanner | Detects |
|---|---|
| `RECON_SYSTEM_USER` | Service users (`TYPE` = SERVICE / LEGACY_SERVICE) running `SHOW`/`DESCRIBE`/metadata-view queries across many object types |
| `MULTI_IP_LOGIN` | Users with successful logins from many distinct IPs in the lookback window |

New findings are stored in `FINDINGS` and emailed via `SYSTEM$SEND_EMAIL`. A task runs the scan hourly.

[`sql/06_realtime_scanner_information_schema.sql`](sql/06_realtime_scanner_information_schema.sql) adds a near-real-time scanner (`SCAN_REALTIME`, run by `SCAN_REALTIME_TASK` every 5 minutes) built on `INFORMATION_SCHEMA` table functions, so there is no `ACCOUNT_USAGE` latency. It only looks at users listed in `WATCHED_USERS` and writes to `FINDINGS`:

| Scanner | Detects |
|---|---|
| `RT_IP_HOPPING` | Successful logins from many distinct IPs |
| `RT_FAILED_LOGINS` | Repeated failed logins |
| `RT_LOGIN_BURST` | Sudden volume (default 50 attempts, success or failure, any number of IPs), many attempts from a single IP (default 20), or a spike versus the user's own baseline (default 5x) |
| `RT_UNEXPECTED_CLIENT` | Client types such as `PYTHON_DRIVER` instead of `ODBC`: checked against the per-user `EXPECTED_CLIENTS` allowlist when one exists, otherwise against the client types the user normally uses |
| `RT_RECON` | `SHOW`/`DESCRIBE`/metadata-view enumeration |

Thresholds are in `RT_CONFIG`. The task is created suspended; resume it with `ALTER TASK SCAN_REALTIME_TASK RESUME;`. `INFORMATION_SCHEMA` only covers the last 7 days and returns at most 10,000 rows per call, so very busy accounts can be truncated.

## Data movement policy and violation alert

[`sql/03_data_movement_policy.sql`](sql/03_data_movement_policy.sql) creates a sample `PROGRAMMATIC_FETCH` policy (alert above 75 rows, block above 300) and attaches it to the account. It is account-wide, so review it before running; `ALTER ACCOUNT UNSET DATA MOVEMENT POLICY;` removes it.

[`sql/04_dmp_violation_alert.sql`](sql/04_dmp_violation_alert.sql) adds a Snowflake alert, `DMP_VIOLATION_ALERT`, that emails new rows from `SNOWFLAKE.ACCOUNT_USAGE.DATA_MOVEMENT_VIOLATIONS` every 60 minutes. It tracks the last notified time in `DMP_ALERT_STATE` so each violation is sent once. Violations appear in ACCOUNT_USAGE with up to 3 hours of latency.

[`sql/05_dmp_block_alert_realtime.sql`](sql/05_dmp_block_alert_realtime.sql) adds `DMP_BLOCK_ALERT_REALTIME`, which checks `INFORMATION_SCHEMA.QUERY_HISTORY` every 5 minutes for blocked queries (error 100168), so blocks are reported without the `ACCOUNT_USAGE` latency. It cannot see alert-only (allowed) events; the 04 alert covers those.

## Deploy (Snowflake CLI)

1. Edit `sql/01_deploy.sql`: replace `<YOUR_DB>`, `<YOUR_WAREHOUSE>`, `<YOUR_VERIFIED_EMAIL>` (must be a verified user email in the account).
2. `snow sql -c <connection> -f sql/01_deploy.sql`
3. `snow sql -c <connection> -f sql/02_demo_run.sql` (run inside the `TRUST_SCANNER` schema)
4. Optional alert: replace the same placeholders in [`sql/04_dmp_violation_alert.sql`](sql/04_dmp_violation_alert.sql), run it with `snow sql -c <connection> -f`, then `ALTER ALERT DMP_VIOLATION_ALERT RESUME;` (alerts are created suspended)
5. Optional real-time block alert: same steps with `sql/05_dmp_block_alert_realtime.sql`, then `ALTER ALERT DMP_BLOCK_ALERT_REALTIME RESUME;`
6. Optional real-time scanner: replace the placeholders (including `<YOUR_WATCHED_USER>`) in `sql/06_realtime_scanner_information_schema.sql` and run it after step 2
7. Cleanup: `sql/99_teardown.sql`

Requires ACCOUNTADMIN (or equivalent) and `SNOWFLAKE.ACCOUNT_USAGE` access.

## Tuning
`SCANNER_CONFIG`: `LOOKBACK_HOURS` (24), `RECON_DISTINCT_MIN` (5), `IP_DISTINCT_MIN` (3).

## Limitations
`ACCOUNT_USAGE` latency: up to ~45 min (queries) / ~2 h (logins). Findings are not shown in the Trust Center UI.
Demo only; not a replacement for Snowflake Trust Center.
