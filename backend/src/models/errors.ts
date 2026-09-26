/**
 * Travelog MVP1 — Application Error Classes
 *
 * All errors follow the ApiError contract defined in OpenAPI:
 *   { code, message, details }
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "SCAN_NOT_FOUND"
  | "SCAN_ALREADY_RUNNING"
  | "SCAN_NOT_RUNNING"
  | "PHOTO_NOT_FOUND"
  | "EXIF_READ_ERROR"
  | "FILE_NOT_FOUND"
  | "TRIP_NOT_FOUND"
  | "TRIP_OVERLAP"
  | "TRIP_NOT_ACTIVE"
  | "INVALID_MODIFICATION"
  | "SPLIT_VIOLATION"
  | "MERGE_INVALID"
  | "ADMIN_AREA_NOT_FOUND"
  | "LOCALITY_NOT_FOUND"
  | "EXCLUSION_ZONE_NOT_FOUND"
  | "GEOAPIFY_NOT_CONFIGURED"
  | "PLACE_NOT_FOUND"
  | "SETTINGS_INVALID"
  | "INTERNAL_ERROR";

export interface AppErrorOptions {
  code?: ErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Base application error with structured error response.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, statusCode: number, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details ?? {};
  }

  /**
   * Convert to API error response shape.
   */
  toApiError(): { code: string; message: string; details: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Validation error (400) — request body or parameters don't match schema.
 */
export class ValidationError extends AppError {
  constructor(message: string, fields?: Record<string, unknown>) {
    const details = fields ? { fields } : {};
    super("VALIDATION_ERROR", message, 400, { details });
    this.name = "ValidationError";
  }
}

const NOT_FOUND_CODES = {
  Trip: "TRIP_NOT_FOUND",
  Scan: "SCAN_NOT_FOUND",
  Locality: "LOCALITY_NOT_FOUND",
  "Exclusion zone": "EXCLUSION_ZONE_NOT_FOUND",
} as const satisfies Record<string, ErrorCode>;

/**
 * Not found error (404).
 */
export class NotFoundError extends AppError {
  constructor(entity: keyof typeof NOT_FOUND_CODES, id?: string | number) {
    const message = id !== undefined ? `${entity} with id ${id} not found` : `${entity} not found`;
    super(NOT_FOUND_CODES[entity], message, 404);
    this.name = "NotFoundError";
  }
}

/**
 * Conflict error (409) — e.g., concurrent scan, overlapping trips.
 * The machine-readable code is required: every 409 must carry the exact
 * domain reason (SCAN_ALREADY_RUNNING, SCAN_NOT_RUNNING, TRIP_OVERLAP,
 * TRIP_NOT_ACTIVE, ...).
 */
export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode) {
    super(code, message, 409);
    this.name = "ConflictError";
  }
}
