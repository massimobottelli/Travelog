/**
 * Travelog MVP1 — Request body reader tests (size limit for /data/import)
 */

import { describe, it, expect } from "vitest";
import { readBodyWithLimit } from "../request-body.js";
import { AppError } from "../../models/errors.js";

/** Feed an async generator of chunks to readBodyWithLimit. */
async function* fromChunks(chunks: Array<Buffer | string>): AsyncIterable<Buffer | string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("readBodyWithLimit", () => {
  it("concatenates all chunks within the limit", async () => {
    const body = await readBodyWithLimit(fromChunks([Buffer.from("hello "), "world"]), 1024);
    expect(body.toString("utf8")).toBe("hello world");
  });

  it("accepts a body exactly at the limit", async () => {
    const body = await readBodyWithLimit(fromChunks([Buffer.from("12345678")]), 8);
    expect(body.length).toBe(8);
  });

  it("rejects a body exceeding the limit with the ApiError contract", async () => {
    const promise = readBodyWithLimit(fromChunks([Buffer.from("123456789")]), 8);
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await promise.catch((err: AppError) => {
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.statusCode).toBe(400);
    });
  });

  it("rejects when the limit is exceeded across multiple chunks", async () => {
    const promise = readBodyWithLimit(
      fromChunks([Buffer.from("1234"), Buffer.from("5678"), Buffer.from("9")]),
      8,
    );
    await expect(promise).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  });

  it("returns an empty buffer for an empty stream", async () => {
    const body = await readBodyWithLimit(fromChunks([]), 8);
    expect(body.length).toBe(0);
  });
});
