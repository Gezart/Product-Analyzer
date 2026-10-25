// Errors a route answers with their own status. Pure (no imports).

/**
 * An expected failure with an HTTP status (400 bad input, 403 not on this plan, 404 not found,
 * 409 conflict, 502 Shopify refused, …). `data` is added to the JSON answer (e.g. `{ upgrade }`).
 */
export class HttpError extends Error {
  status;
  data;

  constructor(message, status, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** An error's message, shortened for storing or showing. */
export function errorMessage(error, max = 500) {
  return (error instanceof Error ? error.message : String(error)).slice(0, max);
}
