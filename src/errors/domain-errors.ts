export type ErrorCode =
  | 'INGEST_ERROR'
  | 'UNKNOWN_SOURCE'
  | 'UNMAPPED_STATUS'
  | 'INVALID_QUERY'
  | 'INVALID_CURRENCY'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR';

export class RevenueError extends Error {
  readonly code: ErrorCode;
  readonly context: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RevenueError';
    this.code = code;
    this.context = context;
  }
}

export class IngestError extends RevenueError {
  constructor(source: string, message: string, context: Record<string, unknown> = {}) {
    super('INGEST_ERROR', `${source} ingest failed: ${message}`, { source, ...context });
    this.name = 'IngestError';
  }
}

export class UnknownSourceError extends RevenueError {
  constructor(source: string) {
    super('UNKNOWN_SOURCE', `Unknown source: "${source}"`, { source });
    this.name = 'UnknownSourceError';
  }
}

/**
 * Thrown when a source emits a status string that has no mapping to a
 * canonical status. By design these transactions are still inserted with
 * canonical_status = UNKNOWN — never silently counted as revenue — and the
 * /metrics/status-coverage endpoint surfaces them for code-level mapping
 * to be added.
 */
export class UnmappedStatusError extends RevenueError {
  constructor(source: string, rawStatus: string, sourceTransactionId: string) {
    super('UNMAPPED_STATUS', `Unmapped status from ${source}: "${rawStatus}"`, {
      source,
      rawStatus,
      sourceTransactionId,
    });
    this.name = 'UnmappedStatusError';
  }
}

export class InvalidQueryError extends RevenueError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('INVALID_QUERY', message, context);
    this.name = 'InvalidQueryError';
  }
}

export class InvalidCurrencyError extends RevenueError {
  constructor(currency: string) {
    super('INVALID_CURRENCY', `Currency "${currency}" is not supported (USD only for MVP)`, {
      currency,
    });
    this.name = 'InvalidCurrencyError';
  }
}
