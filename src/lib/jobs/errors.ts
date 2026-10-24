/** Throw from a handler when retrying cannot help (bad input, deleted resource). */
export class PermanentJobError extends Error {
  name = "PermanentJobError";
}

export class JobTimeoutError extends Error {
  name = "JobTimeoutError";
}
