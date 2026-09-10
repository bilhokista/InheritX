-- A rejected webhook never reaches the payload parser, so the columns that
-- describe a parsed event cannot be populated for one. They are relaxed to
-- NULL rather than filled with sentinels, so "we never learned this" is
-- distinguishable from a real value.
ALTER TABLE kyc_webhook_logs ALTER COLUMN wallet_address DROP NOT NULL;
ALTER TABLE kyc_webhook_logs ALTER COLUMN event_type DROP NOT NULL;
ALTER TABLE kyc_webhook_logs ALTER COLUMN kyc_status DROP NOT NULL;
ALTER TABLE kyc_webhook_logs ALTER COLUMN raw_payload DROP NOT NULL;

-- Why the request was rejected before processing, e.g. 'mismatch'.
-- NULL for a request that authenticated successfully.
ALTER TABLE kyc_webhook_logs ADD COLUMN auth_failure_reason TEXT;

-- Supports the audit query this column exists for: recent authentication
-- failures, newest first.
CREATE INDEX kyc_webhook_logs_auth_failure_idx
    ON kyc_webhook_logs (processed_at DESC)
    WHERE auth_failure_reason IS NOT NULL;
