/**
 * Travelog MVP1 — Request body reader with a hard size limit
 *
 * The backup import (POST /data/import) accepts an arbitrary-sized raw
 * body: reading it into memory without a bound is a denial-of-service
 * vector. This helper streams the body and rejects anything above the
 * limit with the standard ApiError contract (400 VALIDATION_ERROR, a
 * response already declared by the OpenAPI contract of /data/import).
 *
 * Pure (no Express types) so the behavior is unit-testable.
 */

import { AppError } from "../models/errors.js";

/** Upper bound for a backup upload: the catalog of a personal photo archive. */
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024; // 256 MB

/**
 * Read the whole stream into a single Buffer, rejecting bodies larger
 * than `maxBytes`. When the limit is exceeded the remaining stream is
 * drained (without buffering) so the error response can still be
 * delivered on the same connection.
 */
export async function readBodyWithLimit(
  stream: AsyncIterable<Buffer | string>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of stream) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (tooLarge) continue;
    if (total > maxBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooLarge) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Il file supera la dimensione massima consentita per l'importazione.",
      400,
    );
  }
  return Buffer.concat(chunks);
}
