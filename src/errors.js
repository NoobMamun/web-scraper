export class ScrapeError extends Error {
  /**
   * @param {string} code    machine-readable code, e.g. INVALID_URL
   * @param {string} message user-facing message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
