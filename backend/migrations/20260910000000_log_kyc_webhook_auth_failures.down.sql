DROP INDEX IF EXISTS kyc_webhook_logs_auth_failure_idx;
ALTER TABLE kyc_webhook_logs DROP COLUMN IF EXISTS auth_failure_reason;

-- Restoring NOT NULL requires removing the rows that could not populate these
-- columns; they are exactly the authentication failures this migration added.
DELETE FROM kyc_webhook_logs
    WHERE wallet_address IS NULL
       OR event_type IS NULL
       OR kyc_status IS NULL
       OR raw_payload IS NULL;

ALTER TABLE kyc_webhook_logs ALTER COLUMN wallet_address SET NOT NULL;
ALTER TABLE kyc_webhook_logs ALTER COLUMN event_type SET NOT NULL;
ALTER TABLE kyc_webhook_logs ALTER COLUMN kyc_status SET NOT NULL;
ALTER TABLE kyc_webhook_logs ALTER COLUMN raw_payload SET NOT NULL;
