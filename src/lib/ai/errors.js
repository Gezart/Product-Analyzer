/** An AI failure with a message for the merchant (and the usage spent, when there was any). */
export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
