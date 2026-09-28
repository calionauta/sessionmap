import { SyncMessage } from '../types';

const CHANNEL_NAME = 'narratips_sync_channel';
const STORAGE_SYNC_KEY = 'narratips_sync_storage_event';

type MessageHandler = (msg: SyncMessage) => void;

class SyncService {
  private channel: BroadcastChannel | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private isClient: boolean = false;
  private heartbeatInterval: number | null = null;
  private lastPongTime: number = 0;
  private clientConnected: boolean = false;
  private onConnectionChangeCallbacks: Set<(connected: boolean) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        if ('BroadcastChannel' in window) {
          this.channel = new BroadcastChannel(CHANNEL_NAME);
          this.channel.onmessage = (event) => {
            this.handleIncoming(event.data);
          };
        }
      } catch {
        // BroadcastChannel might fail in some sandboxed environments
        this.channel = null;
      }

      // Storage event fallback
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_SYNC_KEY && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            this.handleIncoming(data);
          } catch {
            // ignore
          }
        }
      });

      // Cleanup on unload
      window.addEventListener('beforeunload', () => {
        if (this.isClient) {
          this.send({ type: 'bye' });
        }
      });
    }
  }

  public initAsClient() {
    this.isClient = true;
    // Notify host that client is ready
    this.send({ type: 'pong' });
  }

  public startHostHeartbeat() {
    if (this.heartbeatInterval) return;

    // Ping every 2 seconds
    this.heartbeatInterval = window.setInterval(() => {
      this.send({ type: 'ping' });

      // If client hasn't responded in 4.5 seconds, consider disconnected
      if (this.clientConnected && Date.now() - this.lastPongTime > 4500) {
        this.clientConnected = false;
        this.notifyConnectionChange(false);
      }
    }, 2000);
  }

  public stopHostHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public getIsClientConnected(): boolean {
    return this.clientConnected;
  }

  public onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.onConnectionChangeCallbacks.add(cb);
    return () => this.onConnectionChangeCallbacks.delete(cb);
  }

  private notifyConnectionChange(connected: boolean) {
    this.onConnectionChangeCallbacks.forEach((cb) => cb(connected));
  }

  public send(msg: SyncMessage) {
    try {
      if (this.channel) {
        this.channel.postMessage(msg);
      }
    } catch {
      // ignore
    }

    try {
      // Storage fallback
      const payload = JSON.stringify({ ...msg, _t: Date.now() });
      localStorage.setItem(STORAGE_SYNC_KEY, payload);
    } catch {
      // ignore
    }
  }

  public subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private handleIncoming(data: any) {
    if (!data || !data.type) return;
    const msg = data as SyncMessage;

    // Internal heartbeat tracking
    if (msg.type === 'ping') {
      if (this.isClient) {
        this.send({ type: 'pong' });
      }
    } else if (msg.type === 'pong') {
      this.lastPongTime = Date.now();
      if (!this.clientConnected) {
        this.clientConnected = true;
        this.notifyConnectionChange(true);
      }
    } else if (msg.type === 'bye') {
      this.clientConnected = false;
      this.notifyConnectionChange(false);
    }

    this.handlers.forEach((h) => h(msg));
  }
}

export const syncService = new SyncService();
