'use strict';

// Small in-memory sliding-window rate limiter shared by the SMTP and
// HTTP layers. Good enough for a list this size; the process restarting
// clears it, which is an acceptable trade-off here (see README).
class RateLimiter {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.hits = new Map();
    // Without this, `hits` would grow forever as new IPs/addresses show
    // up, even after their entries have expired.
    this.cleanupTimer = setInterval(() => this.cleanup(), windowMs);
    this.cleanupTimer.unref();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter((t) => now - t < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }

  /**
   * Records a hit for `key` and returns whether it's still within
   * `max` hits inside the configured window.
   */
  allow(key, max) {
    const now = Date.now();
    const timestamps = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (timestamps.length >= max) {
      this.hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return true;
  }
}

module.exports = { RateLimiter };
