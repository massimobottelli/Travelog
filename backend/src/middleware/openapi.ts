/** Travelog MVP1 — Request validation compiled from the OpenAPI contract. */
import { Router } from "express";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import type { AnySchema, ErrorObject } from "ajv";
import { loadOpenApiSpec } from "../utils/openapi.js";
import { AppError } from "../models/errors.js";

type Schema = Record<string, unknown>;
interface Parameter {
  name: string;
  in: "path" | "query";
  required?: boolean;
  schema: Schema;
}
interface Body {
  required?: boolean;
  content: Record<string, { schema: Schema }>;
}
interface Operation {
  operationId: string;
  parameters?: Schema[];
  requestBody?: Schema;
}
const methods = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;

function errorsAt(location: string, errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).map((error) => {
    const missing = error.keyword === "required" ? String(error.params.missingProperty) : null;
    const suffix = missing === null ? "" : `/${missing.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    return {
      path: `/${location}${error.instancePath}${suffix}`,
      message: error.message ?? "Invalid value",
    };
  });
}

/** Compile before listening. Missing/invalid schemas never disable validation. */
export function createOpenApiValidator(): Router {
  const spec = loadOpenApiSpec();
  const root = { components: spec.components };
  function ajv(coerceTypes: boolean) {
    // OpenAPI annotations and nullable are supported. Schema validation stays on.
    const instance = new Ajv2020({ strict: false, allErrors: true, coerceTypes });
    formats.default(instance);
    return instance;
  }
  const bodies = ajv(false);
  const parameters = ajv(true);
  function resolve<T>(value: Schema): T {
    if (typeof value.$ref !== "string") return value as T;
    if (!value.$ref.startsWith("#/"))
      throw new Error("Only internal OpenAPI references are supported");
    let target: unknown = spec;
    for (const part of value.$ref.slice(2).split("/")) {
      target = (target as Schema)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    if (!target) throw new Error("Unresolved OpenAPI reference");
    return target as T;
  }
  function compile(instance: Ajv2020, schema: Schema) {
    return instance.compile({ ...root, ...schema } as AnySchema);
  }
  const router = Router();
  const paths = spec.paths as Record<string, Record<string, unknown>>;
  // Literal paths take precedence over parameter templates, independent of YAML order.
  const entries = Object.entries(paths).sort(
    ([a], [b]) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0),
  );
  for (const [path, item] of entries) {
    const route = router.route(path.replace(/\{([^}]+)\}/g, ':"$1"'));
    for (const method of methods) {
      if (!item[method]) continue;
      const operation = item[method] as Operation;
      const merged = new Map<string, Parameter>();
      for (const value of [
        ...((item.parameters as Schema[]) ?? []),
        ...(operation.parameters ?? []),
      ]) {
        const p = resolve<Parameter>(value);
        if (p.in !== "path" && p.in !== "query")
          throw new Error("Unsupported OpenAPI parameter location");
        if (p.in === "path" && !path.includes(`{${p.name}}`))
          throw new Error("Path parameter missing from template");
        merged.set(`${p.in}:${p.name}`, p);
      }
      const validators = (["path", "query"] as const).map((location) => {
        const params = [...merged.values()].filter((p) => p.in === location);
        return {
          location,
          validate: compile(parameters, {
            type: "object",
            properties: Object.fromEntries(params.map((p) => [p.name, p.schema])),
            required: params.filter((p) => p.required).map((p) => p.name),
          }),
        };
      });
      const body = operation.requestBody ? resolve<Body>(operation.requestBody) : undefined;
      const schema = body?.content["application/json"]?.schema;
      // Non-JSON media types (e.g. application/octet-stream) are allowed but
      // not schema-validated by the OpenAPI middleware.
      const validateBody = schema ? compile(bodies, schema) : undefined;
      route[method]((req, _res, next) => {
        const errors: { path: string; message: string }[] = [];
        for (const { location, validate } of validators) {
          // Express 5 query is a getter: validate copies, without defaults/mutations.
          const input = { ...(location === "path" ? req.params : req.query) };
          if (!validate(input)) errors.push(...errorsAt(location, validate.errors));
        }
        if (validateBody && (req.body !== undefined || body?.required)) {
          if (!validateBody(req.body)) errors.push(...errorsAt("body", validateBody.errors));
        }
        if (errors.length) {
          next(
            new AppError("VALIDATION_ERROR", "Request does not match the API contract", 400, {
              details: { errors },
            }),
          );
          return;
        }
        // Exit validation router; do not also validate a matching template route.
        next("router");
      });
    }
  }
  return router;
}
