import type { IngestedEvent, StreamsBus } from './types';

/**
 * In-process event bus (D-306). The ingest path publishes AFTER its transaction commits, once per event that is new
 * to ev_events. Duplicates, replay and backfill publish nothing. Listener exceptions are caught and reported through
 * `onError`; they never affect ingestion or other listeners.
 */
export interface Bus extends StreamsBus {
  publish(e: IngestedEvent): void;
  size(): number;
}

export function createBus(onError: (err: unknown, e: IngestedEvent) => void = () => {}): Bus {
  const listeners = new Set<(e: IngestedEvent) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(e) {
      for (const l of [...listeners]) {
        try {
          l(e);
        } catch (err) {
          onError(err, e);
        }
      }
    },
    size: () => listeners.size,
  };
}
