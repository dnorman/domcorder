/**
 * Rate limiter for events that ensures events are emitted at most once per specified interval
 */
export class EventRateLimiter {
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private storedEvents: Map<string, any> = new Map();

  /**
   * Rate limit an event
   * @param key Unique key for this event type
   * @param intervalMs Minimum interval between events in milliseconds
   * @param eventData The event data to potentially emit
   * @param emitCallback Function to call when an event should be emitted
   */
  rateLimit<T>(
    key: string,
    intervalMs: number,
    eventData: T,
    emitCallback: (data: T) => void
  ): void {
    const existingTimer = this.timers.get(key);
    const hasStoredEvent = this.storedEvents.has(key);

    if (!existingTimer && !hasStoredEvent) {
      // First event - emit immediately and start timer
      emitCallback(eventData);
      this.startTimer(key, intervalMs, emitCallback);
    } else {
      // Store as most recent event (overwrites previous stored event)
      this.storedEvents.set(key, eventData);
    }
  }

  private startTimer<T>(key: string, intervalMs: number, emitCallback: (data: T) => void): void {
    const timerId = setTimeout(() => {
      // Check if we have a stored event to emit
      const storedEvent = this.storedEvents.get(key);
      if (storedEvent) {
        emitCallback(storedEvent);
        this.storedEvents.delete(key);
        // Start timer for next emission
        this.startTimer(key, intervalMs, emitCallback);
      } else {
        // No stored event, clear timer
        this.timers.delete(key);
      }
    }, intervalMs);

    this.timers.set(key, timerId);
  }

  /**
   * Clear all timers and stored events
   */
  clear(): void {
    this.timers.forEach(timerId => clearTimeout(timerId));
    this.timers.clear();
    this.storedEvents.clear();
  }
}
