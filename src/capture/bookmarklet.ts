// Bookmarklet entry point for DomCorder
import { ScreenRecordingUtility } from './ScreenRecordingUtility.js';
import { DCRRWriter, FrameType } from '../format.js';

// Global interface for the bookmarklet
declare global {
    interface Window {
        DomCorder?: {
            capture: () => Promise<void>;
            startRecording: () => Promise<void>;
            stopRecording: () => void;
            isRecording: boolean;
        };
    }
}

class DomCorderBookmarklet {
    private recorder: ScreenRecordingUtility;
    private writer: DCRRWriter | null = null;
    private websocket: WebSocket | null = null;
    private serverUrl = 'ws://localhost:8547/record';

    constructor() {
        this.recorder = new ScreenRecordingUtility();
    }

    async capture(): Promise<void> {
        try {
            console.log('DomCorder: Capturing keyframe...');

            const html = await this.recorder.captureKeyframe();
            const width = window.innerWidth;
            const height = window.innerHeight;

            // Create a single-frame .dcrr file
            const writer = new DCRRWriter();
            writer.addViewport(width, height);
            writer.addKeyframe(html);
            const dcrr = writer.serialize();

            // Send to server
            await this.sendToServer(dcrr);

            console.log('DomCorder: Keyframe captured and sent to server');

            // Show user feedback
            this.showNotification('📸 Page captured!', 'success');

        } catch (error) {
            console.error('DomCorder capture failed:', error);
            this.showNotification('❌ Capture failed', 'error');
        }
    }

    async startRecording(): Promise<void> {
        if (this.websocket) {
            console.log('DomCorder: Already recording');
            return;
        }

        try {
            console.log('DomCorder: Starting recording...');

            // Initialize writer
            const width = window.innerWidth;
            const height = window.innerHeight;
            this.writer = new DCRRWriter();
            this.writer.addViewport(width, height);

            // Connect WebSocket
            this.websocket = new WebSocket(this.serverUrl);

            this.websocket.onopen = () => {
                console.log('DomCorder: Connected to server');
                this.showNotification('🔴 Recording started', 'success');
            };

            this.websocket.onclose = () => {
                console.log('DomCorder: Disconnected from server');
                this.websocket = null;
            };

            this.websocket.onerror = (error) => {
                console.error('DomCorder WebSocket error:', error);
                this.showNotification('❌ Connection failed', 'error');
                this.websocket = null;
            };

            // Wait for connection
            await new Promise((resolve, reject) => {
                this.websocket!.onopen = resolve;
                this.websocket!.onerror = reject;
                setTimeout(reject, 5000); // 5 second timeout
            });

            // Send initial keyframe
            await this.sendKeyframe();

            // Start periodic keyframes (1 fps)
            this.startPeriodicCapture();

        } catch (error) {
            console.error('DomCorder recording failed to start:', error);
            this.showNotification('❌ Recording failed to start', 'error');
            this.stopRecording();
        }
    }

    stopRecording(): void {
        if (!this.websocket) {
            console.log('DomCorder: Not recording');
            return;
        }

        console.log('DomCorder: Stopping recording...');

        // Stop the recorder
        this.recorder.stopRecording();

        // Send final .dcrr file
        if (this.writer) {
            const dcrr = this.writer.serialize();
            this.sendBinary(dcrr);
        }

        // Close WebSocket
        this.websocket.close();
        this.websocket = null;
        this.writer = null;

        this.showNotification('⏹️ Recording stopped', 'info');
    }

    get isRecording(): boolean {
        return this.websocket !== null;
    }

    private async sendKeyframe(): Promise<void> {
        if (!this.writer || !this.websocket) return;

        const html = await this.recorder.captureKeyframe();
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.writer.addKeyframe(html);

        // Send keyframe message
        this.sendMessage({
            type: 'keyframe',
            timestamp: Date.now(),
            width,
            height,
            data: html
        });
    }

    private startPeriodicCapture(): void {
        const interval = setInterval(async () => {
            if (!this.websocket) {
                clearInterval(interval);
                return;
            }

            try {
                await this.sendKeyframe();
            } catch (error) {
                console.error('DomCorder periodic capture failed:', error);
            }
        }, 1000); // 1 second interval
    }

    private async sendToServer(data: Uint8Array): Promise<void> {
        try {
            const response = await fetch('http://localhost:8547/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Action': 'capture',
                },
                body: data,
            });

            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}`);
            }

        } catch (error) {
            console.error('Failed to send to server:', error);
            throw error;
        }
    }

    private sendMessage(message: any): void {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            return;
        }

        const json = JSON.stringify(message);
        this.websocket.send(json);
    }

    private sendBinary(data: Uint8Array): void {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            return;
        }

        this.websocket.send(data);
    }

    private showNotification(message: string, type: 'success' | 'error' | 'info'): void {
        // Create a simple notification overlay
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
}

// Initialize and expose globally
function initDomCorder() {
    if (window.DomCorder) {
        console.log('DomCorder already initialized');
        return;
    }

    const bookmarklet = new DomCorderBookmarklet();

    window.DomCorder = {
        capture: () => bookmarklet.capture(),
        startRecording: () => bookmarklet.startRecording(),
        stopRecording: () => bookmarklet.stopRecording(),
        get isRecording() { return bookmarklet.isRecording; }
    };

    console.log('DomCorder initialized. Use DomCorder.capture() or DomCorder.startRecording()');

    // Auto-capture if this is a one-shot bookmark
    const urlParams = new URLSearchParams(window.location.hash.substring(1));
    if (urlParams.get('auto') === 'capture') {
        bookmarklet.capture();
    }
}

// Auto-initialize when script loads
initDomCorder(); 