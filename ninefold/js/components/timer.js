// timer.js — a pausable countdown ticker. Timestamp-based so it stays accurate
// across pause/resume and tab throttling. Drives the routine engine (§6).

export class Ticker {
  // onTick(remainingSeconds, justCrossedSecond), onDone()
  constructor({ onTick, onDone } = {}) {
    this.onTick = onTick || (() => {});
    this.onDone = onDone || (() => {});
    this._raf = null;
    this._endAt = 0;
    this._remainingMs = 0;
    this._running = false;
    this._lastWhole = null;
  }

  start(seconds) {
    this.stop();
    this._remainingMs = seconds * 1000;
    this._endAt = performance.now() + this._remainingMs;
    this._running = true;
    this._lastWhole = Math.ceil(this._remainingMs / 1000);
    this.onTick(this._lastWhole, true);
    this._loop();
  }

  _loop() {
    const step = () => {
      if (!this._running) return;
      const now = performance.now();
      const remMs = Math.max(0, this._endAt - now);
      const whole = Math.ceil(remMs / 1000);
      if (whole !== this._lastWhole) {
        this._lastWhole = whole;
        this.onTick(whole, true);
      }
      if (remMs <= 0) {
        this._running = false;
        this.onDone();
        return;
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  pause() {
    if (!this._running) return;
    this._running = false;
    this._remainingMs = Math.max(0, this._endAt - performance.now());
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  resume() {
    if (this._running) return;
    this._endAt = performance.now() + this._remainingMs;
    this._running = true;
    this._loop();
  }

  addSeconds(delta) {
    const base = this._running ? this._endAt - performance.now() : this._remainingMs;
    const next = Math.max(0, base + delta * 1000);
    this._remainingMs = next;
    if (this._running) {
      this._endAt = performance.now() + next;
      this._lastWhole = Math.ceil(next / 1000);
      this.onTick(this._lastWhole, true);
    } else {
      this._lastWhole = Math.ceil(next / 1000);
      this.onTick(this._lastWhole, true);
    }
  }

  get running() { return this._running; }
  get remaining() {
    return Math.ceil((this._running ? this._endAt - performance.now() : this._remainingMs) / 1000);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }
}
