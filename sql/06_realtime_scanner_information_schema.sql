-- Near-real-time scanner on INFORMATION_SCHEMA (no ACCOUNT_USAGE latency) for a watched user population:
--   RT_IP_HOPPING     many distinct IPs for successful logins
--   RT_RECON          SHOW/DESCRIBE/metadata-view enumeration breadth
--   RT_FAILED_LOGINS  repeated failed logins
--   RT_LOGIN_BURST    sudden login volume (success + failure), same-IP frequency, or spike vs the user's baseline
--   RT_UNEXPECTED_CLIENT  client type (e.g. PYTHON_DRIVER vs ODBC) not on the user's allowlist, or new vs their own history
-- Run after 01_deploy.sql (reuses the TRUST_SCANNER schema, FINDINGS table and email integration).
-- INFORMATION_SCHEMA table functions cover the last 7 days and return at most 10000 rows per call.
USE ROLE ACCOUNTADMIN;
USE DATABASE <YOUR_DB>;
USE SCHEMA TRUST_SCANNER;

CREATE OR REPLACE TABLE WATCHED_USERS (
  USER_NAME VARCHAR,
  ADDED_AT  TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);
INSERT INTO WATCHED_USERS (USER_NAME) VALUES ('<YOUR_WATCHED_USER>');

CREATE OR REPLACE TABLE RT_CONFIG (
  WINDOW_MINUTES     NUMBER,
  IP_DISTINCT_MIN    NUMBER,
  RECON_DISTINCT_MIN NUMBER,
  FAILED_LOGIN_MIN   NUMBER,
  LOGIN_BURST_MIN    NUMBER,  -- total attempts in the window, any number of IPs
  SAME_IP_MIN        NUMBER,  -- attempts from one single IP in the window
  SPIKE_RATIO        NUMBER,  -- window attempts vs the user's average window in the baseline period
  SPIKE_MIN_ATTEMPTS NUMBER,  -- ignore spikes below this many attempts
  BASELINE_HOURS     NUMBER,  -- history used for the baseline (window + this must stay under 7 days)
  CLIENT_BASELINE_HOURS NUMBER -- history used to learn a user's usual client types (window + this under 7 days)
);
INSERT INTO RT_CONFIG VALUES (60, 3, 5, 5, 50, 20, 5, 10, 24, 144);

-- Optional per-user allowlist of client types (REPORTED_CLIENT_TYPE, e.g. ODBC, JDBC_DRIVER, PYTHON_DRIVER,
-- SQL_API, SNOWFLAKE_UI). Users with rows here are checked against the allowlist; users without rows are
-- checked against their own history.
CREATE OR REPLACE TABLE EXPECTED_CLIENTS (
  USER_NAME   VARCHAR,
  CLIENT_TYPE VARCHAR
);

CREATE OR REPLACE PROCEDURE SCAN_REALTIME()
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  win NUMBER; imin NUMBER; rmin NUMBER; fmin NUMBER;
  bmin NUMBER; sameip NUMBER; sratio NUMBER; smin NUMBER; bh NUMBER; cbh NUMBER;
  rcpt VARCHAR; integ VARCHAR; new_cnt NUMBER DEFAULT 0; body VARCHAR;
BEGIN
  SELECT WINDOW_MINUTES, IP_DISTINCT_MIN, RECON_DISTINCT_MIN, FAILED_LOGIN_MIN,
         LOGIN_BURST_MIN, SAME_IP_MIN, SPIKE_RATIO, SPIKE_MIN_ATTEMPTS, BASELINE_HOURS, CLIENT_BASELINE_HOURS
    INTO :win, :imin, :rmin, :fmin, :bmin, :sameip, :sratio, :smin, :bh, :cbh FROM RT_CONFIG LIMIT 1;
  SELECT RECIPIENT, EMAIL_INTEGRATION INTO :rcpt, :integ FROM SCANNER_CONFIG LIMIT 1;

  -- IP hopping (watched users only)
  INSERT INTO FINDINGS (SCANNER_ID, SEVERITY, ENTITY, SUMMARY, DETAILS)
  SELECT 'RT_IP_HOPPING', IFF(ips >= :imin * 2, 'HIGH', 'MEDIUM'), user_name,
         logins || ' successful logins from ' || ips || ' distinct IPs in ' || :win || ' min',
         OBJECT_CONSTRUCT('ips', ip_list, 'first_seen', first_seen, 'last_seen', last_seen)
  FROM (
    SELECT USER_NAME AS user_name, COUNT(*) AS logins, COUNT(DISTINCT CLIENT_IP) AS ips,
           ARRAY_AGG(DISTINCT CLIENT_IP) AS ip_list,
           MIN(EVENT_TIMESTAMP) AS first_seen, MAX(EVENT_TIMESTAMP) AS last_seen
    FROM TABLE(<YOUR_DB>.INFORMATION_SCHEMA.LOGIN_HISTORY(
           TIME_RANGE_START => DATEADD('minute', -:win, CURRENT_TIMESTAMP()),
           TIME_RANGE_END => CURRENT_TIMESTAMP(), RESULT_LIMIT => 10000))
    WHERE IS_SUCCESS = 'YES' AND UPPER(USER_NAME) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS)
    GROUP BY USER_NAME
    HAVING COUNT(DISTINCT CLIENT_IP) >= :imin
  ) m
  WHERE NOT EXISTS (SELECT 1 FROM FINDINGS f WHERE f.SCANNER_ID = 'RT_IP_HOPPING' AND f.ENTITY = m.user_name
                    AND f.DETECTED_AT >= DATEADD('minute', -:win, CURRENT_TIMESTAMP()));

  -- Repeated failed logins (watched users only)
  INSERT INTO FINDINGS (SCANNER_ID, SEVERITY, ENTITY, SUMMARY, DETAILS)
  SELECT 'RT_FAILED_LOGINS', IFF(fails >= :fmin * 2, 'HIGH', 'MEDIUM'), user_name,
         fails || ' failed logins from ' || ips || ' IPs in ' || :win || ' min',
         OBJECT_CONSTRUCT('ips', ip_list, 'errors', err_list, 'first_seen', first_seen, 'last_seen', last_seen)
  FROM (
    SELECT USER_NAME AS user_name, COUNT(*) AS fails, COUNT(DISTINCT CLIENT_IP) AS ips,
           ARRAY_AGG(DISTINCT CLIENT_IP) AS ip_list, ARRAY_AGG(DISTINCT ERROR_MESSAGE) AS err_list,
           MIN(EVENT_TIMESTAMP) AS first_seen, MAX(EVENT_TIMESTAMP) AS last_seen
    FROM TABLE(<YOUR_DB>.INFORMATION_SCHEMA.LOGIN_HISTORY(
           TIME_RANGE_START => DATEADD('minute', -:win, CURRENT_TIMESTAMP()),
           TIME_RANGE_END => CURRENT_TIMESTAMP(), RESULT_LIMIT => 10000))
    WHERE IS_SUCCESS = 'NO' AND UPPER(USER_NAME) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS)
    GROUP BY USER_NAME
    HAVING COUNT(*) >= :fmin
  ) f2
  WHERE NOT EXISTS (SELECT 1 FROM FINDINGS f WHERE f.SCANNER_ID = 'RT_FAILED_LOGINS' AND f.ENTITY = f2.user_name
                    AND f.DETECTED_AT >= DATEADD('minute', -:win, CURRENT_TIMESTAMP()));

  -- Login burst: volume (any IPs), same-IP frequency, or spike vs baseline (watched users only)
  INSERT INTO FINDINGS (SCANNER_ID, SEVERITY, ENTITY, SUMMARY, DETAILS)
  SELECT 'RT_LOGIN_BURST', IFF(ARRAY_SIZE(reasons) >= 2, 'HIGH', 'MEDIUM'), user_name,
         attempts || ' login attempts (' || fails || ' failed) from ' || ips || ' IP(s) in ' || :win
           || ' min; top single-IP count ' || max_ip,
         OBJECT_CONSTRUCT('reasons', reasons, 'attempts', attempts, 'failed', fails, 'succeeded', ok,
                          'distinct_ips', ips, 'attempts_per_ip', ip_counts,
                          'baseline_attempts_per_window', ROUND(base_per_win, 1))
  FROM (
    SELECT c.user_name, c.attempts, c.ok, c.fails, c.ips, t.ip_counts, t.max_ip,
           COALESCE(b.n, 0) / GREATEST((:bh * 60) / :win, 1) AS base_per_win,
           ARRAY_CONSTRUCT_COMPACT(
             IFF(c.attempts >= :bmin, 'VOLUME', NULL),
             IFF(t.max_ip >= :sameip, 'SAME_IP_FREQUENCY', NULL),
             IFF(c.attempts >= :smin
                 AND c.attempts / GREATEST(COALESCE(b.n, 0) / GREATEST((:bh * 60) / :win, 1), 1) >= :sratio,
                 'SPIKE_VS_BASELINE', NULL)) AS reasons
    FROM (
      SELECT UPPER(USER_NAME) AS u, MAX(USER_NAME) AS user_name, COUNT(*) AS attempts,
             COUNT_IF(IS_SUCCESS = 'YES') AS ok, COUNT_IF(IS_SUCCESS = 'NO') AS fails,
             COUNT(DISTINCT CLIENT_IP) AS ips
      FROM TABLE(<YOUR_DB>.INFORMATION_SCHEMA.LOGIN_HISTORY(
             TIME_RANGE_START => DATEADD('minute', -:win, CURRENT_TIMESTAMP()),
             TIME_RANGE_END => CURRENT_TIMESTAMP(), RESULT_LIMIT => 10000))
      WHERE UPPER(USER_NAME) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS)
      GROUP BY UPPER(USER_NAME)
    ) c
    JOIN (
      SELECT u, OBJECT_AGG(CLIENT_IP, n::VARIANT) AS ip_counts, MAX(n) AS max_ip
      FROM (
        SELECT UPPER(USER_NAME) AS u, CLIENT_IP, COUNT(*) AS n
        FROM TABLE(<YOUR_DB>.INFORMATION_SCHEMA.LOGIN_HISTORY(
               TIME_RANGE_START => DATEADD('minute', -:win, CURRENT_TIMESTAMP()),
               TIME_RANGE_END => CURRENT_TIMESTAMP(), RESULT_LIMIT => 10000))
        WHERE UPPER(USER_NAME) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS)
        GROUP BY UPPER(USER_NAME), CLIENT_IP
      ) GROUP BY u
    ) t ON t.u = c.u
    LEFT JOIN (
      SELECT UPPER(USER_NAME) AS u, COUNT(*) AS n
      FROM TABLE(<YOUR_DB>.INFORMATION_SCHEMA.LOGIN_HISTORY(
             TIME_RANGE_START => DATEADD('hour', -:bh, DATEADD('minute', -:win, CURRENT_TIMESTAMP())),
             TIME_RANGE_END => DATEADD('minute', -:win, CURRENT_TIMESTAMP()), RESULT_LIMIT => 10000))
      WHERE UPPER(USER_NAME) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS)
      GROUP BY UPPER(USER_NAME)
    ) b ON b.u = c.u
  ) x
  WHERE ARRAY_SIZE(reasons) > 0
    AND NOT EXISTS (SELECT 1 FROM FINDINGS f WHERE f.SCANNER_ID = 'RT_LOGIN_BURST' AND f.ENTITY = x.user_name
                    AND f.DETECTED_AT >= DATEADD('minute', -:win, CURRENT_TIMESTAMP()));

  -- Unexpected client types: allowlist when the user has one, otherwise new vs the user's own history
  INSERT INTO FINDINGS (SCANNER_ID, SEVERITY, ENTITY, SUMMARY, DETAILS)
  WITH cur AS (
    SELECT UPPER(USER_NAME) AS u, MAX(USER_NAME) AS user_name, UPPER(REPORTED_CLIENT_TYPE) AS ct,
           COUNT(*) AS n, COUNT_IF(IS_SUCCESS = 'YES') AS ok,
           ARRAY_AGG(DISTINCT REPORTED_CLIENT_VERSION) AS versions, ARRAY_AGG(DISTINCT CLIENT_IP) AS ips
    FROM TABLE(<YOUR_DB>.INFORMATION_SCHEMA.LOGIN_HISTORY(
           TIME_RANGE_START => DATEADD('minute', -:win, CURRENT_TIMESTAMP()),
           TIME_RANGE_END => CURRENT_TIMESTAMP(), RESULT_LIMIT => 10000))
    WHERE UPPER(USER_NAME) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS)
    GROUP BY UPPER(USER_NAME), UPPER(REPORTED_CLIENT_TYPE)
  ),
  base AS (
    SELECT DISTINCT UPPER(USER_NAME) AS u, UPPER(REPORTED_CLIENT_TYPE) AS ct
    FROM TABLE(<YOUR_DB>.INFORMATION_SCHEMA.LOGIN_HISTORY(
           TIME_RANGE_START => DATEADD('hour', -:cbh, DATEADD('minute', -:win, CURRENT_TIMESTAMP())),
           TIME_RANGE_END => DATEADD('minute', -:win, CURRENT_TIMESTAMP()), RESULT_LIMIT => 10000))
    WHERE IS_SUCCESS = 'YES' AND UPPER(USER_NAME) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS)
  ),
  allow AS (SELECT UPPER(USER_NAME) AS u, UPPER(CLIENT_TYPE) AS ct FROM EXPECTED_CLIENTS),
  hits AS (
    SELECT c.user_name, c.ct, c.n, c.ok, c.versions, c.ips,
           IFF(EXISTS (SELECT 1 FROM allow a0 WHERE a0.u = c.u), 'NOT_IN_ALLOWLIST', 'NEW_VS_BASELINE') AS reason
    FROM cur c
    WHERE (EXISTS (SELECT 1 FROM allow a0 WHERE a0.u = c.u)
           AND NOT EXISTS (SELECT 1 FROM allow a WHERE a.u = c.u AND a.ct = c.ct))
       OR (NOT EXISTS (SELECT 1 FROM allow a0 WHERE a0.u = c.u)
           AND EXISTS (SELECT 1 FROM base b0 WHERE b0.u = c.u)
           AND NOT EXISTS (SELECT 1 FROM base b WHERE b.u = c.u AND b.ct = c.ct))
  )
  SELECT 'RT_UNEXPECTED_CLIENT', IFF(SUM(ok) > 0, 'HIGH', 'MEDIUM'), user_name,
         'Unexpected client type(s) ' || LISTAGG(DISTINCT ct, ', ') || ' in ' || :win || ' min',
         OBJECT_CONSTRUCT('clients', ARRAY_AGG(OBJECT_CONSTRUCT('client_type', ct, 'reason', reason,
                          'attempts', n, 'succeeded', ok, 'versions', versions, 'ips', ips)))
  FROM hits h
  WHERE NOT EXISTS (SELECT 1 FROM FINDINGS f WHERE f.SCANNER_ID = 'RT_UNEXPECTED_CLIENT' AND f.ENTITY = h.user_name
                    AND f.DETECTED_AT >= DATEADD('minute', -:win, CURRENT_TIMESTAMP()))
  GROUP BY user_name;

  -- Reconnaissance (watched users only)
  INSERT INTO FINDINGS (SCANNER_ID, SEVERITY, ENTITY, SUMMARY, DETAILS)
  SELECT 'RT_RECON', IFF(kinds >= :rmin * 2, 'HIGH', 'MEDIUM'), user_name,
         total || ' reconnaissance queries across ' || kinds || ' object types in ' || :win || ' min',
         OBJECT_CONSTRUCT('kinds', kind_list, 'first_seen', first_seen, 'last_seen', last_seen)
  FROM (
    SELECT USER_NAME AS user_name, COUNT(*) AS total, COUNT(DISTINCT kind) AS kinds,
           ARRAY_AGG(DISTINCT kind) AS kind_list, MIN(START_TIME) AS first_seen, MAX(START_TIME) AS last_seen
    FROM (
      SELECT USER_NAME, START_TIME,
             COALESCE(UPPER(REGEXP_SUBSTR(QUERY_TEXT, '(SHOW|DESCRIBE|DESC)\\s+[A-Za-z_]+(\\s+[A-Za-z_]+)?', 1, 1, 'i')),
                      'METADATA_VIEW') AS kind
      FROM TABLE(<YOUR_DB>.INFORMATION_SCHEMA.QUERY_HISTORY(
             END_TIME_RANGE_START => DATEADD('minute', -:win, CURRENT_TIMESTAMP()), RESULT_LIMIT => 10000))
      WHERE UPPER(USER_NAME) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS)
        AND ( REGEXP_LIKE(QUERY_TEXT, '\\s*(SHOW|DESCRIBE|DESC)\\s+(USERS|ROLES|GRANTS|WAREHOUSES|DATABASES|SCHEMAS|TABLES|INTEGRATIONS|NETWORK|SHARES|STAGES|SECRETS|PARAMETERS|SECURITY|STORAGE|API|MANAGED|EXTERNAL|FUNCTIONS|PROCEDURES|TASKS|PIPES|STREAMS|VIEWS|COLUMNS).*', 'is')
           OR REGEXP_LIKE(QUERY_TEXT, '.*(ACCOUNT_USAGE|INFORMATION_SCHEMA)\\.(USERS|ROLES|GRANTS_TO_\\w+|GRANTS_ON_\\w+|LOGIN_HISTORY|SESSIONS|DATABASES|TABLES|COLUMNS|NETWORK_POLICIES|INTEGRATIONS)\\b.*', 'is') )
    )
    GROUP BY USER_NAME
    HAVING COUNT(DISTINCT kind) >= :rmin
  ) r
  WHERE NOT EXISTS (SELECT 1 FROM FINDINGS f WHERE f.SCANNER_ID = 'RT_RECON' AND f.ENTITY = r.user_name
                    AND f.DETECTED_AT >= DATEADD('minute', -:win, CURRENT_TIMESTAMP()));

  SELECT COUNT(*) INTO :new_cnt FROM FINDINGS WHERE NOT NOTIFIED;
  IF (new_cnt > 0) THEN
    SELECT LISTAGG('[' || SEVERITY || '] ' || SCANNER_ID || ' | ' || ENTITY || ' | ' || SUMMARY || ' | ' || TO_VARCHAR(DETAILS), '\n')
      INTO :body FROM FINDINGS WHERE NOT NOTIFIED;
    CALL SYSTEM$SEND_EMAIL(:integ, :rcpt, 'Real-time Trust Scanner: ' || :new_cnt || ' finding(s)', :body);
    UPDATE FINDINGS SET NOTIFIED = TRUE WHERE NOT NOTIFIED;
  END IF;
  RETURN 'new findings notified: ' || new_cnt;
END;
$$;

-- Tasks are created suspended; run ALTER TASK SCAN_REALTIME_TASK RESUME; to start it.
CREATE OR REPLACE TASK SCAN_REALTIME_TASK
  WAREHOUSE = <YOUR_WAREHOUSE>
  SCHEDULE = '5 MINUTE'
AS CALL SCAN_REALTIME();
