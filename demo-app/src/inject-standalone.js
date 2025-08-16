// Standalone DomCorder injection script
// This is a simplified version that includes the core functionality inline

(function () {
  "use strict";

  // Avoid double injection
  if (window.DomCorder) {
    console.log("DomCorder already loaded");
    return;
  }

  console.log("DomCorder: Initializing...");

  // Simple notification system
  function showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      background: ${
        type === "success"
          ? "#10b981"
          : type === "error"
          ? "#ef4444"
          : "#3b82f6"
      };
      animation: domcorder-slide-in 0.3s ease-out;
    `;

    // Add animation keyframes if not already present
    if (!document.querySelector("#domcorder-styles")) {
      const styles = document.createElement("style");
      styles.id = "domcorder-styles";
      styles.textContent = `
        @keyframes domcorder-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `;
      document.head.appendChild(styles);
    }

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  // Simplified HTML capture (basic version of ScreenRecordingUtility.captureKeyframe)
  async function captureHTML() {
    try {
      // Create a simplified HTML snapshot
      const html = document.documentElement.outerHTML;
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Simple .dcrr-like format - just JSON for now to get started
      const recording = {
        version: 1,
        createdAt: Date.now(),
        frames: [
          {
            timestamp: 0,
            type: "viewport",
            data: { width, height },
          },
          {
            timestamp: 1,
            type: "keyframe",
            data: { html },
          },
        ],
      };

      return JSON.stringify(recording);
    } catch (error) {
      console.error("Capture failed:", error);
      throw error;
    }
  }

  // Send capture to server
  async function sendToServer(data, action = "capture") {
    try {
      const response = await fetch("http://localhost:3000/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Action": action,
        },
        body: data,
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("Failed to send to server:", error);
      throw error;
    }
  }

  // Main capture function
  async function capture() {
    try {
      console.log("DomCorder: Capturing page...");
      showNotification("📸 Capturing...", "info");

      const data = await captureHTML();
      await sendToServer(data, "capture");

      console.log("DomCorder: Capture completed");
      showNotification("✅ Page captured!", "success");
    } catch (error) {
      console.error("DomCorder capture failed:", error);
      showNotification("❌ Capture failed", "error");
    }
  }

  // Expose API
  window.DomCorder = {
    capture,
    version: "0.1.0",
  };

  console.log("DomCorder: Ready! Use DomCorder.capture() to capture the page.");

  // Auto-capture for immediate testing
  capture();
})();
