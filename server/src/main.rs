use domcorder_server::{StorageState, server};
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::main]
async fn main() {
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
    println!("DomCorder server listening on http://127.0.0.1:8723");
    println!("Storage directory: {}", storage_dir.display());

    axum::serve(listener, app).await.unwrap();
}
