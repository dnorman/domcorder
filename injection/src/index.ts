import {
    PageRecorder,
    PageRecordingClient,
    FrameChunkWriter,
} from "@domcorder/browser-core";

declare global {
    interface Window {
        DomCorder?: {
            start: () => void;
            stop: () => void;
            isRecording: () => boolean;
            recorder?: PageRecorder;
            client?: PageRecordingClient;
        };
    }
}

// Avoid double injection
if ((window as any).DomCorder) {
    console.log("DomCorder already loaded");
} else {
    console.log("🎬 DomCorder: Initializing...");

    const pageRecorder = new PageRecorder(document);

    // Connect to the recording server at 127.0.0.1:8723
    const pageRecordingClient = new PageRecordingClient(
        pageRecorder,
        "ws://127.0.0.1:8723/ws/record"
    );

    // Visual feedback helper
    function showNotification(message: string, type: 'success' | 'error' | 'info' = 'info') {
        const notification = document.createElement('div');
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
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      animation: domcorder-slide-in 0.3s ease-out;
    `;

        // Add animation keyframes if not already present
        if (!document.querySelector('#domcorder-styles')) {
            const styles = document.createElement('style');
            styles.id = 'domcorder-styles';
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

    // Recording indicator
    let indicatorElement: HTMLElement | null = null;

    function showRecordingIndicator() {
        if (indicatorElement) return;

        indicatorElement = document.createElement('div');
        indicatorElement.innerHTML = '🔴 Recording';
        indicatorElement.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      padding: 8px 16px;
      border-radius: 20px;
      background: rgba(239, 68, 68, 0.9);
      color: white;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      font-weight: 600;
      z-index: 999999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      animation: domcorder-pulse 2s ease-in-out infinite;
    `;

        // Add pulse animation
        if (!document.querySelector('#domcorder-pulse-style')) {
            const styles = document.createElement('style');
            styles.id = 'domcorder-pulse-style';
            styles.textContent = `
        @keyframes domcorder-pulse {
          0%, 100% { opacity: 0.9; }
          50% { opacity: 0.6; }
        }
      `;
            document.head.appendChild(styles);
        }

        document.body.appendChild(indicatorElement);
    }

    function hideRecordingIndicator() {
        if (indicatorElement) {
            indicatorElement.remove();
            indicatorElement = null;
        }
    }

    // Expose the API
    (window as any).DomCorder = {
        start: () => {
            console.log("🎬 DomCorder: Starting recording...");
            try {
                pageRecordingClient.start();
                pageRecorder.start();
                showNotification('Recording started', 'success');
                showRecordingIndicator();
            } catch (error) {
                console.error("Failed to start recording:", error);
                showNotification('Failed to start recording', 'error');
            }
        },
        stop: () => {
            console.log("🎬 DomCorder: Stopping recording...");
            try {
                pageRecorder.stop();
                pageRecordingClient.stop();
                showNotification('Recording stopped', 'info');
                hideRecordingIndicator();
            } catch (error) {
                console.error("Failed to stop recording:", error);
                showNotification('Failed to stop recording', 'error');
            }
        },
        isRecording: () => {
            return pageRecordingClient.getWebSocket() !== null;
        },
        recorder: pageRecorder,
        client: pageRecordingClient,
    };

    console.log("🎬 DomCorder: Ready! Use DomCorder.start() to begin recording.");

    // Auto-start recording - wait for page to be ready
    function startRecording() {
        showNotification('DomCorder loaded - starting recording...', 'info');
        (window as any).DomCorder.start();
    }

    // Start immediately if document is already loaded, otherwise wait for DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startRecording);
    } else {
        // Document is already loaded, start immediately (like the test page)
        startRecording();
    }
}
