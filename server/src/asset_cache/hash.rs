//! Hashing and ID generation utilities for asset identification

use sha2::{Digest, Sha256};
use rand::RngCore;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};

/// Compute SHA-256 hash (manifest hash and storage key) of data
pub fn sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Generate a random ID for asset retrieval
/// 
/// Uses 32 bytes (256 bits) of cryptographically secure randomness,
/// encoded as Base64url (43 characters, URL-safe, no padding).
pub fn generate_random_id() -> String {
    let mut random_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut random_bytes);
    URL_SAFE_NO_PAD.encode(&random_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256() {
        let data = b"test data";
        let hash = sha256(data);
        assert_eq!(hash.len(), 64); // SHA-256 produces 64 hex chars
    }

    #[test]
    fn test_sha256_deterministic() {
        let data = b"test data";
        let h1 = sha256(data);
        let h2 = sha256(data);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_random_id() {
        let id1 = generate_random_id();
        let id2 = generate_random_id();
        
        // Should be 43 characters (32 bytes * 8 bits / 6 bits per char = 42.67, rounded up)
        assert_eq!(id1.len(), 43);
        assert_eq!(id2.len(), 43);
        
        // Should be different (extremely unlikely to collide)
        assert_ne!(id1, id2);
        
        // Should be URL-safe (no padding, no + or /)
        assert!(!id1.contains('+'));
        assert!(!id1.contains('/'));
        assert!(!id1.contains('='));
    }
}

