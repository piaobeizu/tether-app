/**
 * Error type for any failure surfaced from the Rust wt module.
 * Rust returns errors as plain strings via `Result<T, String>`; we wrap them.
 */
export class TetherWtError extends Error {
  constructor(public readonly op: string, msg: string) {
    super(`[tether-wt:${op}] ${msg}`);
    this.name = "TetherWtError";
  }
}
