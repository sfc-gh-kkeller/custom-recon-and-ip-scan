## Design brief

* **Who and when:** a security analyst on call, mid-shift, glancing at a second screen while something may be going wrong with one of the watched accounts.
* **The one question:** is anyone on the watchlist behaving suspiciously right now?
* **Focal element:** the count of flagged watched users, set huge in the display face over a per-minute login timeline (successful vs failed) that ends in a pulsing "now" marker.
* **Direction:** air-traffic radar in a dim operations room. Green-black background, phosphor green for normal activity, amber for warnings, signal red for failures and blocks. Oswald (condensed display), IBM Plex Sans (text), JetBrains Mono (IDs, IPs, queries). Dark by default, with a paper-and-ink light theme. Not doing: stat-card rows, boxed everything, blue gradients.
* **Signature detail:** the timeline's "now" marker pulses on every refresh, with a visible "updated Ns ago" tick, so staleness is obvious.
* **Next step:** from a flagged user row the analyst can abort running queries, disable (type the user name to confirm) or re-enable the account; every action is written to the containment log shown on the same screen.
* **Trust:** logins and blocked data movement come from `INFORMATION_SCHEMA` (live); allowed-with-alert events come from `ACCOUNT_USAGE` (up to 3 hours behind) and are labelled as such. Times are shown in the viewer's local time zone. Headline numbers are checked against direct queries.

# Watchtower

Real-time dashboard for the watched-user scanner in this repository, built on Snowflake App Runtime (Next.js). It polls every 15 to 120 seconds and has a Live/Paused switch and a time window (15 min to 12 hours) kept in the URL.

| Panel | Source | Freshness |
|---|---|---|
| Flagged count + login timeline | `TRUST_SCANNER.FINDINGS`, `INFORMATION_SCHEMA.LOGIN_HISTORY` | live |
| Flagged users (with containment actions) | `FINDINGS`, `WATCHED_USERS`, `PROTECTED_USERS`, `CONTAINMENT_LOG` | live |
| Findings feed | `FINDINGS` | live |
| Login activity by user | `INFORMATION_SCHEMA.LOGIN_HISTORY` | live |
| Blocked data movement | `INFORMATION_SCHEMA.QUERY_HISTORY` (error 100168), capped at 3 hours | live |
| Movement alerts, 24 hours | `ACCOUNT_USAGE.DATA_MOVEMENT_VIOLATIONS` | up to 3 hours behind |
| Containment log | `CONTAINMENT_LOG` | live |
| Scanner status | `SHOW TASKS` / `SHOW ALERTS`, `RT_CONFIG` | live |

Everything is limited to users on `WATCHED_USERS`. The data queries run as the app's service identity (owner's rights).

## Containment from the dashboard

The buttons call `CONTAIN_USER` from `sql/07_containment.sql`, which refuses protected users, users who are not on the watchlist, and `DISABLE_USER` without confirmation. The dashboard asks the analyst to type the user name before it sends `confirmed: true`, and the API route rejects cross-origin posts. Every action, including refusals, is written to `CONTAINMENT_LOG` with `dashboard` as the requester.

Because the app uses owner's rights, **anyone who can open the app can use these buttons**. Share it only with security analysts: `GRANT USAGE ON APPLICATION SERVICE <db>.<schema>.WATCHTOWER TO ROLE <analyst_role>;`. The audit log records `dashboard`, not the individual analyst. In production, deploy the app under a dedicated role that has only the privileges it needs, not ACCOUNTADMIN.

## Prerequisites

- The scanner objects from `sql/01` through `sql/07` deployed in one database (the app reads `TRUST_SCANNER` and `DMP_DEMO` there).
- Snowflake CLI 3.26 or later and Node.js.
- Snowflake App Runtime enabled on the account.

## Run locally

```bash
npm install
SCANNER_DB=<YOUR_DB> npm run dev
```

The app uses your default `snow` connection. Open the port the dev server prints.

## Deploy

1. Create a schema for the app, for example `CREATE SCHEMA <YOUR_DB>.APPS;`.
2. In `app.yml`, replace `<YOUR_DB>`, `<YOUR_APP_SCHEMA>` and `<YOUR_WAREHOUSE>` (`snow app setup --app-name=watchtower --database <YOUR_DB> --schema <APPS_SCHEMA> --dry-run` shows the values for your account). Do not commit your real values.
3. `snow app deploy --connection <connection>`, then `SHOW APPLICATION SERVICES` for the URL.
4. Remove it again with `snow app teardown --force`.

The first build takes several minutes, and the endpoint can take a few more to appear.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SCANNER_DB` | the app's current database | database holding the scanner objects |
| `SCANNER_SCHEMA` | `TRUST_SCANNER` | schema with `FINDINGS`, `WATCHED_USERS`, ... |
| `ALERT_SCHEMA` | `DMP_DEMO` | schema with the alerts shown in Scanner status |

## Limits

- `INFORMATION_SCHEMA` login and query functions cover 7 days and return at most 10,000 rows per call, before the watchlist filter.
- The live blocked-movement panel is capped at 3 hours because the account-wide query-history scan gets slow quickly (3 hours took about 18 seconds and 23 hours over 5 minutes in testing).
- Every panel polls on a warehouse, so each open dashboard keeps `<YOUR_WAREHOUSE>` busy. Use Paused when nobody is watching.

## Tests

`npm test` runs Vitest (formatters, window validation, and the containment route's validation and bind handling). `npm run build` must pass before deploying.
