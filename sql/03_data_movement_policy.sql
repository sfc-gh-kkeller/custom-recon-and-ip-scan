-- Sample data movement policy for PROGRAMMATIC_FETCH: alert above 75 rows, block above 300 rows.
-- Requires Enterprise Edition and the CREATE/APPLY DATA MOVEMENT POLICY privileges (ACCOUNTADMIN here).
USE ROLE ACCOUNTADMIN;
USE DATABASE <YOUR_DB>;
CREATE SCHEMA IF NOT EXISTS DMP_DEMO;
USE SCHEMA DMP_DEMO;

CREATE OR REPLACE DATA MOVEMENT RULE DMP_FETCH_ALERT_75
  TYPE = 'PROGRAMMATIC_FETCH'
  MAX_ROWS AS () RETURNS INTEGER -> (75)
  COMMENT = 'Alert when a programmatic fetch exceeds 75 rows';

CREATE OR REPLACE DATA MOVEMENT RULE DMP_FETCH_BLOCK_300
  TYPE = 'PROGRAMMATIC_FETCH'
  MAX_ROWS AS () RETURNS INTEGER -> (300)
  COMMENT = 'Block programmatic fetches above 300 rows';

CREATE OR REPLACE DATA MOVEMENT POLICY DMP_FETCH_SAMPLE_POLICY
  ENFORCE_RULES = (DMP_FETCH_BLOCK_300)
  ALERT_RULES = (DMP_FETCH_ALERT_75)
  COMMENT = 'Sample: alert above 75 rows, block above 300 rows for programmatic fetch';

-- Account-level attachment: applies to every table/view without a tag-based policy, for all users.
-- Only one account-level policy can be active (add FORCE to replace one).
ALTER ACCOUNT SET DATA MOVEMENT POLICY <YOUR_DB>.DMP_DEMO.DMP_FETCH_SAMPLE_POLICY;

-- Remove the attachment:
-- ALTER ACCOUNT UNSET DATA MOVEMENT POLICY;
