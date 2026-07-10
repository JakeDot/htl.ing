'use strict';

// Small in-memory sliding-window rate limiter shared by the SMTP and
// HTTP layers. Good enough for a list this size; the process restarting
// clears it, which is an acceptable trade-off here (see README).
class RateLimiter {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.hits = new Map();
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
