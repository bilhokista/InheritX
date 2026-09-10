use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;

use crate::stellar_submit::SorobanConfig;

pub struct Config {
    pub port: u16,
    pub database_url: String,
    /// Optional read-only replica. `None` means every query uses the primary.
    ///
    /// See [`Config::resolve_read_database_url`] for why a value identical to
    /// `database_url` is treated as absent.
    pub read_database_url: Option<String>,
    pub redis_url: Option<String>,
    pub plan_cache_ttl_secs: u64,
    /// TTL for the cached `/api/analytics/plan-statistics` response. Kept
    /// separate from `plan_cache_ttl_secs` since the statistics query
    /// aggregates the whole `plans` table and is far more expensive than a
    /// single plan lookup, so admins tolerate a longer staleness window.
    pub plan_statistics_cache_ttl_secs: u64,
    /// Shared secret used to verify HMAC-SHA256 signatures on inbound KYC
    /// provider webhooks. When unset, `/api/kyc/webhook` rejects every request.
    pub kyc_webhook_secret: Option<String>,
    pub stellar_horizon_url: String,
    pub anchor_api_url: String,
    pub fiat_daily_limit_default: rust_decimal::Decimal,
    /// Soroban contract settings used to execute inheritance payouts on-chain.
    /// `None` when the deployment has not configured a signer, in which case
    /// the inactivity watchdog only updates PostgreSQL.
    pub soroban: Option<SorobanConfig>,
}

impl Config {
    pub fn load() -> Result<Self, anyhow::Error> {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3001);
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/inheritx".to_string());
        let read_database_url = Self::resolve_read_database_url(
            std::env::var("READ_DATABASE_URL").ok().as_deref(),
            &database_url,
        );
        let redis_url = std::env::var("REDIS_URL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let plan_cache_ttl_secs = std::env::var("PLAN_CACHE_TTL_SECS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(15);
        let plan_statistics_cache_ttl_secs = std::env::var("PLAN_STATISTICS_CACHE_TTL_SECS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(60)
            .max(1);
        let fiat_daily_limit_default = std::env::var("FIAT_DAILY_LIMIT_DEFAULT")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .and_then(Decimal::from_f64)
            .unwrap_or(Decimal::ZERO);
        let kyc_webhook_secret = std::env::var("KYC_WEBHOOK_SECRET")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let stellar_horizon_url = std::env::var("STELLAR_HORIZON_URL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "https://horizon-testnet.stellar.org".to_string());

        let anchor_api_url = std::env::var("ANCHOR_API_URL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "http://localhost:8081".to_string());

        Ok(Config {
            port,
            database_url,
            read_database_url,
            redis_url,
            plan_cache_ttl_secs,
            plan_statistics_cache_ttl_secs,
            kyc_webhook_secret,
            stellar_horizon_url,
            anchor_api_url,
            fiat_daily_limit_default,
            soroban: SorobanConfig::from_env(),
        })
    }
}

impl Config {
    /// Normalises `READ_DATABASE_URL` into an optional replica.
    ///
    /// Returns `None` when unset, blank, or identical to the primary. The last
    /// case matters: a deployment that sets both to the same value is not
    /// running a replica, and opening a second pool to the same server would
    /// double the connection count against `max_connections` while making the
    /// logs claim a replica is in use.
    pub fn resolve_read_database_url(value: Option<&str>, primary: &str) -> Option<String> {
        let candidate = value?.trim();

        if candidate.is_empty() || candidate == primary.trim() {
            None
        } else {
            Some(candidate.to_string())
        }
    }
}

#[cfg(test)]
mod read_replica_tests {
    use super::*;

    const PRIMARY: &str = "postgres://user:pass@primary:5432/inheritx";
    const REPLICA: &str = "postgres://user:pass@replica:5432/inheritx";

    #[test]
    fn a_distinct_replica_is_used() {
        assert_eq!(
            Config::resolve_read_database_url(Some(REPLICA), PRIMARY),
            Some(REPLICA.to_string())
        );
    }

    #[test]
    fn an_unset_or_blank_value_means_no_replica() {
        assert_eq!(Config::resolve_read_database_url(None, PRIMARY), None);
        assert_eq!(Config::resolve_read_database_url(Some(""), PRIMARY), None);
        assert_eq!(Config::resolve_read_database_url(Some("   "), PRIMARY), None);
    }

    #[test]
    fn a_replica_identical_to_the_primary_is_not_a_replica() {
        // Otherwise a second pool doubles the connection count against the
        // same server while the logs claim a replica is in use.
        assert_eq!(Config::resolve_read_database_url(Some(PRIMARY), PRIMARY), None);
    }

    #[test]
    fn surrounding_whitespace_does_not_create_a_phantom_replica() {
        let padded = format!("  {PRIMARY}  ");
        assert_eq!(Config::resolve_read_database_url(Some(&padded), PRIMARY), None);
    }

    #[test]
    fn a_replica_url_is_trimmed() {
        let padded = format!("  {REPLICA}  ");
        assert_eq!(
            Config::resolve_read_database_url(Some(&padded), PRIMARY),
            Some(REPLICA.to_string())
        );
    }
}
