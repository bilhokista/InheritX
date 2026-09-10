#[cfg(feature = "metrics")]
use inheritx_backend::metrics;
use inheritx_backend::{
    create_router, telemetry, AppState, Config, DbManager, InactivityWatchdogConfig,
    InactivityWatchdogService,
};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::signal;
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing logging
    telemetry::init_tracing()?;

    // Initialize Prometheus metrics
    #[cfg(feature = "metrics")]
    metrics::init();

    //loading the .env

    dotenvy::dotenv().ok();

    // Load configuration
    let config = Config::load()?;
    let plan_cache = inheritx_backend::PlanCache::from_redis_url(
        config.redis_url.as_deref(),
        config.plan_cache_ttl_secs,
    )
    .unwrap_or_else(|error| {
        warn!("Redis cache disabled due to invalid configuration: {error}");
        inheritx_backend::PlanCache::disabled()
    });

    // Connect to PostgreSQL and run migrations
    let db_pool = match DbManager::create_pool(&config.database_url).await {
        Ok(pool) => {
            info!("Successfully connected to PostgreSQL database.");

            if let Err(e) = DbManager::run_migrations(&pool).await {
                warn!("Failed to run database migrations: {:?}", e);
            }

            pool
        }
        Err(e) => {
            error!(
                "Failed to connect to PostgreSQL database ({}): {:?}",
                config.database_url, e
            );
            std::process::exit(1);
        }
    };

    if config.kyc_webhook_secret.is_none() {
        warn!("KYC_WEBHOOK_SECRET is not set — /api/kyc/webhook will reject all requests with 503");
    }

    // Build the Stellar client once and share it between the API and the
    // inactivity watchdog, so both talk to the same network and signer.
    let mut stellar_submit = inheritx_backend::stellar_submit::StellarSubmitClient::new(
        config.stellar_horizon_url.clone(),
    );

    match config.soroban.clone() {
        Some(soroban) => {
            let contract_id = soroban.contract_id.clone();
            match stellar_submit.clone().with_soroban(soroban) {
                Ok(client) => {
                    info!(
                        contract_id = %contract_id,
                        "On-chain inheritance triggering enabled"
                    );
                    stellar_submit = client;
                }
                Err(e) => {
                    // Running with a half-configured signer would silently skip
                    // the on-chain payout, so refuse to start instead.
                    error!("Invalid Soroban configuration: {e}");
                    std::process::exit(1);
                }
            }
        }
        None => warn!(
            "SOROBAN_RPC_URL, INHERITANCE_CONTRACT_ID and STELLAR_SIGNER_SECRET are not all set \
             — expired plans will be marked TRIGGERED without executing the on-chain payout"
        ),
    }

    let (kyc_tx, _) = tokio::sync::broadcast::channel(100);
    let (status_tx, _) = tokio::sync::broadcast::channel(100);
    // Initialize state
    let state = Arc::new(AppState {
        anchor: Arc::new(inheritx_backend::stellar_anchor::AnchorRegistry::new(
            config.anchor_api_url.clone(),
        )),
        db_pool: db_pool.clone(),
        kyc_webhook_secret: config.kyc_webhook_secret.clone(),
        apy_config: inheritx_backend::yield_calculator::ApyConfig::from_env(),
        plan_cache: plan_cache.clone(),
        plan_statistics_cache_ttl_secs: config.plan_statistics_cache_ttl_secs,
        apy_cache: dashmap::DashMap::new(),
        kyc_tx: kyc_tx.clone(),
        status_tx,
        stellar_submit: stellar_submit.clone(),
    });

    // Shutdown channel — all background tasks watch this for cancellation
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    // Start inactivity watchdog
    let inactivity_watchdog = Arc::new(
        InactivityWatchdogService::new(
            db_pool.clone(),
            plan_cache,
            InactivityWatchdogConfig::from_env(),
        )
        .with_stellar(stellar_submit),
    );
    // Handles are kept so shutdown can wait for each loop to finish its
    // current iteration instead of closing the pool underneath it.
    let mut background_tasks: Vec<JoinHandle<()>> =
        vec![inactivity_watchdog.start(shutdown_rx.clone())];

    let webhook_dispatcher = Arc::new(inheritx_backend::WebhookDispatcherService::new(
        db_pool.clone(),
    ));
    background_tasks.push(webhook_dispatcher.start(shutdown_rx.clone()));

    // Periodically refresh DB pool metrics
    #[cfg(feature = "metrics")]
    {
        let pool = db_pool.clone();
        let mut rx = shutdown_rx.clone();
        background_tasks.push(tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        metrics::update_db_pool_metrics(&pool);
                    }
                    _ = rx.changed() => {
                        info!("DB pool metrics task shutting down");
                        break;
                    }
                }
            }
        }));
    }

    // Create Axum application
    let app = create_router(state);

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("Starting rebranded INHERITX backend skeleton on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    // Signal all background tasks to stop.
    //
    // Sent explicitly rather than relying on `drop(shutdown_tx)`: dropping the
    // sender happens to wake the receivers, but it says nothing about intent
    // and would stop working the moment any task held a sender clone.
    // `send` cannot fail here: main still holds `shutdown_rx`, so the channel
    // always has at least one receiver.
    let _ = shutdown_tx.send(true);

    // Wait for them before closing the pool. Previously the pool was closed
    // immediately after signalling, so a task in the middle of a transaction
    // could have its connection pulled out from under it.
    await_background_tasks(background_tasks, SHUTDOWN_GRACE).await;

    // Close database connections
    db_pool.close().await;
    info!("Database connections closed. Goodbye.");

    Ok(())
}

/// How long background tasks get to finish after being asked to stop.
///
/// Bounded on purpose: an orchestrator sends SIGKILL after its own timeout
/// (30s by default for Kubernetes and Docker), so waiting indefinitely just
/// converts a clean exit into a killed one. Fifteen seconds leaves room for an
/// in-flight transaction and still lands well inside that budget.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(15);

/// Waits for every background task, giving up after `grace`.
///
/// Returns whether all of them stopped in time, which the caller logs — a
/// timeout means something was still working when the pool closed, and that is
/// worth seeing in the logs of a deploy that later shows odd data.
async fn await_background_tasks(tasks: Vec<JoinHandle<()>>, grace: Duration) -> bool {
    if tasks.is_empty() {
        return true;
    }

    let total = tasks.len();
    let joined = tokio::time::timeout(grace, async {
        for task in tasks {
            // A panicking task must not stop us waiting for the rest, and it
            // has already been reported by the panic hook.
            if let Err(e) = task.await {
                warn!("Background task ended abnormally: {e}");
            }
        }
    })
    .await;

    match joined {
        Ok(()) => {
            info!("All {total} background tasks stopped cleanly");
            true
        }
        Err(_) => {
            warn!(
                "Timed out after {}s waiting for background tasks; closing the pool anyway",
                grace.as_secs()
            );
            false
        }
    }
}

/// Waits for SIGTERM (Unix) or CTRL+C (Windows/Unix) to initiate graceful shutdown.
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => { info!("Received SIGINT (Ctrl+C), starting graceful shutdown"); }
        _ = terminate => { info!("Received SIGTERM, starting graceful shutdown"); }
    }
}
