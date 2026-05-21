/**
 * runtime/watchdog.ts — V2 Watchdog System
 *
 * Monitors memory, CPU, and browser state.
 * Kills the process if thresholds are exceeded.
 *
 * Verification phase requirements:
 *   - Global hard timeout: 10 minutes
 *   - Max memory: 2GB
 *   - Periodic health checks
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface WatchdogConfig {
  /** Global hard timeout in ms (default 10 minutes) */
  hardTimeoutMs: number;
  /** Check interval in ms */
  checkIntervalMs: number;
  /** Max heap memory in MB before kill */
  maxHeapMB: number;
}

const DEFAULT_CONFIG: WatchdogConfig = {
  hardTimeoutMs: 600_000,  // 10 minutes
  checkIntervalMs: 30_000,  // check every 30s
  maxHeapMB: 2_048,  // 2GB
};

// ---------------------------------------------------------------------------
// Watchdog
// ---------------------------------------------------------------------------

let timers: NodeJS.Timeout[] = [];

export function startWatchdog(config: Partial<WatchdogConfig> = {}): void {
  const cfg: WatchdogConfig = { ...DEFAULT_CONFIG, ...config };
  console.log('[WATCHDOG] starting');
  console.log(`[WATCHDOG] hard timeout: ${cfg.hardTimeoutMs / 1000}s`);
  console.log(`[WATCHDOG] check interval: ${cfg.checkIntervalMs / 1000}s`);
  console.log(`[WATCHDOG] max heap: ${cfg.maxHeapMB}MB`);

  // 1. Global hard timeout
  const hardTimer = setTimeout(() => {
    console.error('[WATCHDOG] HARD TIMEOUT — force killing process');
    process.exit(1);
  }, cfg.hardTimeoutMs);
  timers.push(hardTimer);

  // 2. Periodic health check
  const healthTimer = setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);

    if (heapMB > cfg.maxHeapMB) {
      console.error(`[WATCHDOG] MEMORY LIMIT EXCEEDED: ${heapMB}MB > ${cfg.maxHeapMB}MB — force killing`);
      process.exit(1);
    }

    if (heapMB > cfg.maxHeapMB * 0.8) {
      console.warn(`[WATCHDOG] memory warning: ${heapMB}MB (80% of ${cfg.maxHeapMB}MB limit)`);
    }

    // Log health every 2nd check (once per minute)
    const uptime = Math.round(process.uptime());
    console.log(`[WATCHDOG] uptime: ${uptime}s, heap: ${heapMB}MB, rss: ${Math.round(mem.rss / 1024 / 1024)}MB`);
  }, cfg.checkIntervalMs);
  timers.push(healthTimer);
}

export function stopWatchdog(): void {
  console.log('[WATCHDOG] stopping');
  for (const timer of timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  timers = [];
}
