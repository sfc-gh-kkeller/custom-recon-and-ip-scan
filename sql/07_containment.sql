-- Containment for flagged users: guarded procedures, audit log, and an optional automatic rule.
-- Used by the Cortex Agent in agents/containment_agent.agent.yaml. Run after 06_realtime_scanner_information_schema.sql.
-- Procedures run as OWNER (ACCOUNTADMIN here) because ALTER USER needs it; the guards below limit what they can touch:
--   * only users on WATCHED_USERS
--   * never users on PROTECTED_USERS
--   * DISABLE_USER needs confirmed = TRUE (set by the agent only after a human says yes; a guardrail, not authentication)
USE ROLE ACCOUNTADMIN;
USE DATABASE <YOUR_DB>;
USE SCHEMA TRUST_SCANNER;

-- Per-user opt-in for the automatic rule; agent-driven actions need confirmation instead and apply to any watched user.
ALTER TABLE WATCHED_USERS ADD COLUMN IF NOT EXISTS AUTO_CONTAIN BOOLEAN DEFAULT FALSE;

CREATE OR REPLACE TABLE PROTECTED_USERS (USER_NAME VARCHAR);
INSERT INTO PROTECTED_USERS SELECT CURRENT_USER();
INSERT INTO PROTECTED_USERS VALUES ('<YOUR_PROTECTED_USER>');

CREATE OR REPLACE TABLE CONTAINMENT_LOG (
  TS           TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  USER_NAME    VARCHAR,
  ACTION       VARCHAR,
  REQUESTED_BY VARCHAR,
  CONFIRMED    BOOLEAN,
  RESULT       VARCHAR
);

CREATE OR REPLACE PROCEDURE GET_FLAGGED_USERS()
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  r VARCHAR;
BEGIN
  SELECT COALESCE(TO_JSON(ARRAY_AGG(OBJECT_CONSTRUCT(
           'user_name', user_name, 'scanners', scanners, 'finding_count', n,
           'high_severity', high, 'last_detected', last_ts, 'summaries', summaries))), '[]')
    INTO :r
    FROM (
      SELECT ENTITY AS user_name, ARRAY_AGG(DISTINCT SCANNER_ID) AS scanners, COUNT(*) AS n,
             MAX(IFF(SEVERITY = 'HIGH', TRUE, FALSE)) AS high, MAX(DETECTED_AT) AS last_ts,
             ARRAY_AGG(SUMMARY) AS summaries
      FROM FINDINGS
      WHERE DETECTED_AT >= DATEADD('hour', -24, CURRENT_TIMESTAMP())
        AND UPPER(ENTITY) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS)
      GROUP BY ENTITY
    );
  RETURN r;
END;
$$;

CREATE OR REPLACE PROCEDURE CONTAIN_USER(P_USER_NAME VARCHAR, P_ACTION VARCHAR, P_REQUESTED_BY VARCHAR, P_CONFIRMED BOOLEAN)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  u VARCHAR;
  act VARCHAR;
  res VARCHAR;
BEGIN
  u := UPPER(P_USER_NAME);
  act := UPPER(P_ACTION);
  IF (act NOT IN ('ABORT_QUERIES', 'DISABLE_USER', 'ENABLE_USER')) THEN
    res := 'REFUSED: unknown action';
  ELSEIF (NOT EXISTS (SELECT 1 FROM WATCHED_USERS WHERE UPPER(USER_NAME) = :u)) THEN
    res := 'REFUSED: user is not on the watchlist';
  ELSEIF (EXISTS (SELECT 1 FROM PROTECTED_USERS WHERE UPPER(USER_NAME) = :u)) THEN
    res := 'REFUSED: protected user';
  ELSEIF (act = 'DISABLE_USER' AND NOT COALESCE(P_CONFIRMED, FALSE)) THEN
    res := 'REFUSED: DISABLE_USER requires confirmed = true';
  ELSEIF (act = 'ABORT_QUERIES') THEN
    ALTER USER IDENTIFIER(:u) ABORT ALL QUERIES;
    res := 'OK: aborted running queries for ' || u;
  ELSEIF (act = 'DISABLE_USER') THEN
    ALTER USER IDENTIFIER(:u) SET DISABLED = TRUE;
    res := 'OK: disabled ' || u;
  ELSE
    ALTER USER IDENTIFIER(:u) SET DISABLED = FALSE;
    res := 'OK: re-enabled ' || u;
  END IF;
  INSERT INTO CONTAINMENT_LOG (USER_NAME, ACTION, REQUESTED_BY, CONFIRMED, RESULT)
    VALUES (:u, :act, :P_REQUESTED_BY, :P_CONFIRMED, :res);
  RETURN res;
EXCEPTION
  WHEN OTHER THEN
    res := 'ERROR: ' || SQLERRM;
    INSERT INTO CONTAINMENT_LOG (USER_NAME, ACTION, REQUESTED_BY, CONFIRMED, RESULT)
      VALUES (:u, :act, :P_REQUESTED_BY, :P_CONFIRMED, :res);
    RETURN res;
END;
$$;

-- Deterministic rule for "clearly flagged": a watched user with a HIGH finding AND findings from at least two
-- different scanners in the last 60 minutes, and WATCHED_USERS.AUTO_CONTAIN = TRUE. Only the low-regret action
-- (abort running queries) is automatic.
CREATE OR REPLACE PROCEDURE AUTO_CONTAIN()
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
  u VARCHAR;
  res VARCHAR;
  n NUMBER DEFAULT 0;
  c1 CURSOR FOR
    SELECT ENTITY AS user_name
    FROM FINDINGS f
    WHERE f.DETECTED_AT >= DATEADD('minute', -60, CURRENT_TIMESTAMP())
      AND UPPER(f.ENTITY) IN (SELECT UPPER(USER_NAME) FROM WATCHED_USERS WHERE AUTO_CONTAIN)
      AND NOT EXISTS (SELECT 1 FROM CONTAINMENT_LOG l WHERE UPPER(l.USER_NAME) = UPPER(f.ENTITY)
                      AND l.REQUESTED_BY = 'auto' AND l.TS >= DATEADD('minute', -60, CURRENT_TIMESTAMP()))
    GROUP BY ENTITY
    HAVING COUNT(DISTINCT SCANNER_ID) >= 2 AND MAX(IFF(SEVERITY = 'HIGH', 1, 0)) = 1;
BEGIN
  FOR rec IN c1 DO
    u := rec.user_name;
    CALL CONTAIN_USER(:u, 'ABORT_QUERIES', 'auto', TRUE) INTO :res;
    n := n + 1;
  END FOR;
  RETURN 'auto-contained users: ' || n;
END;
$$;

-- Created suspended, chained after the scanner task. Resume the child before the root task.
CREATE OR REPLACE TASK AUTO_CONTAIN_TASK
  WAREHOUSE = <YOUR_WAREHOUSE>
  AFTER SCAN_REALTIME_TASK
AS CALL AUTO_CONTAIN();
