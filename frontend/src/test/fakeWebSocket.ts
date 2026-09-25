/**
 * WebSocket stand-in, stubbed globally for every test (setup.ts). Nothing happens until a
 * test drives it: `open()`, `receive(frame)`, `serverClose(code)`. `latest()` is the most
 * recent socket the app opened.
 */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static latest(): FakeWebSocket | undefined {
    return FakeWebSocket.instances.at(-1);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('socket not open');
    this.sent.push(data);
  }

  /** The client closing (no close event reaches it once it detached its handlers). */
  close(code = 1000): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.closedWith = code;
    this.onclose?.({ code } as CloseEvent);
  }

  // ── Test controls ────────────────────────────────────────────────────────────

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }

  serverClose(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }

  /** Every frame the client sent, parsed. */
  frames(): Record<string, unknown>[] {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
  }
}
