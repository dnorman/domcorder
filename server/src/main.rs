use domcorder_server::{StorageState, server};
use hyper_util::rt::TokioIo;
use hyper_util::server::conn::auto::Builder as ConnBuilder;
use std::path::PathBuf;
use std::sync::Arc;
use tower::Service;
use tracing::{debug, error, info};

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "debug,hyper=debug,h2=debug".into()),
        )
        .init();
    // Initialize storage
    let storage_dir = std::env::var("STORAGE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./recordings"));

    let state = Arc::new(StorageState::new(storage_dir.clone()));

    // Create and run the server
    let app = server::create_app(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8723")
        .await
        .unwrap();
    info!("DomCorder server listening on http://127.0.0.1:8723 (HTTP/1.1 + HTTP/2)");
    info!("Storage directory: {}", storage_dir.display());

    // Use hyper's auto-negotiating server to support both HTTP/1.1 and HTTP/2
    let conn_builder = ConnBuilder::new(hyper_util::rt::TokioExecutor::new());

    loop {
        let (stream, addr) = listener.accept().await.unwrap();
        info!("New connection from: {}", addr);
        let io = TokioIo::new(stream);
        let app_clone = app.clone();
        let conn_builder = conn_builder.clone();

        tokio::spawn(async move {
            debug!("Starting connection handler for {}", addr);
            if let Err(err) = conn_builder
                .serve_connection_with_upgrades(
                    io,
                    hyper::service::service_fn(move |req| {
                        debug!(
                            "Incoming request: {} {} {:?}",
                            req.method(),
                            req.uri(),
                            req.version()
                        );
                        debug!("Request headers: {:?}", req.headers());
                        app_clone.clone().call(req)
                    }),
                )
                .await
            {
                error!("Error serving connection from {}: {}", addr, err);
            } else {
                debug!("Connection from {} completed successfully", addr);
            }
        });
    }
}
