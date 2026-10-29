/** Returned by a job handler to ask for another run later (polling, waiting on Meta processing). */
export type HandlerResult = void | { retryInMs: number; payload?: Record<string, unknown>; note?: string };
