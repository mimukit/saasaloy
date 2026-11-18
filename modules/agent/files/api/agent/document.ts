import { config } from "@repo/config";
import { generateSpecs } from "hono-openapi";
import type { Hono } from "hono";
import { AGENT_EXTENSION } from "../contract";
import type { AgentStatement } from "../contract";

// The OpenAPI document and the MCP tool list, both read from the route statements.
//
// Every route states itself once, with `declare(...)` from `../contract` (ADR 0063).
// `hono-openapi`'s `generateSpecs` walks the finished app and writes one operation per
// declared route, with the `x-agent` statement on it. A closed route is hidden, so the
// document lists the routes an agent may call and nothing else. The tool list is that
// same document read back: one tool per operation, so the two can never disagree.

/** A statement that makes a route a tool. */
export type CallableStatement = Extract<AgentStatement, { callable: true }>;

/** The document `generateSpecs` writes. */
export type OpenApiDocument = Awaited<ReturnType<typeof generateSpecs>>;

/** A JSON Schema object, as far as the tool list reads one. */
export interface ObjectSchema {
  [keyword: string]: unknown;
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties?: boolean;
}

/** One callable route, as an MCP tool. */
export interface AgentTool {
  /** The route's `name`: the tool name and the `operationId`. */
  name: string;
  description: string;
  /** Upper case: `GET`, `POST`. */
  method: string;
  /** The OpenAPI path, braces for parameters: `/notes/{id}`. */
  path: string;
  /** One flat object: the path, query and body fields side by side. */
  inputSchema: ObjectSchema;
  pathParams: string[];
  queryParams: string[];
  /** The route takes a JSON body, built from every argument that is not a parameter. */
  hasBody: boolean;
  agent: CallableStatement;
}

/** Any finished Hono app: the api's, or a test's. */
// oxlint-disable-next-line typescript/no-explicit-any -- every app shape is read the same way
export type RoutedApp = Hono<any, any, any>;

/** One document per app, rebuilt only when a route is added after the first build. */
const built = new WeakMap<
  object,
  { routes: number; document: Promise<OpenApiDocument> }
>();

/**
 * The OpenAPI document of `app`, without a `servers` entry; `withServer` adds the origin
 * of the request that asks. The schema conversion runs once per isolate, on first use.
 */
export function openApiDocument(app: RoutedApp): Promise<OpenApiDocument> {
  const cached = built.get(app);
  if (cached && cached.routes === app.routes.length) {
    return cached.document;
  }
  const document = generateSpecs(app, {
    documentation: {
      components: {
        securitySchemes: {
          key: {
            description:
              "An API key sent as `Authorization: Bearer <key>`. Its scopes limit what it may call.",
            scheme: "bearer",
            type: "http",
          },
        },
      },
      info: {
        description: config.agent.description,
        title: config.app.name,
        version: config.agent.version,
      },
      security: [{ key: [] }],
    },
    // The api's 400 is the shared error envelope, not the library's own schema.
    defaultValidationErrorResponse: false,
  }).then(addPathParameters);
  built.set(app, { document, routes: app.routes.length });
  return document;
}

/** The document as one origin serves it. */
export function withServer(
  document: OpenApiDocument,
  origin: string
): OpenApiDocument & { servers: { url: string }[] } {
  return { ...document, servers: [{ url: origin }] };
}

interface Parameter {
  in: string;
  name: string;
  required?: boolean;
  schema?: unknown;
}

interface Operation {
  operationId?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  security?: Record<string, string[]>[];
  [AGENT_EXTENSION]?: AgentStatement;
}

const METHODS = ["get", "put", "post", "delete", "patch"] as const;

/**
 * A path parameter that no validator checks (`/cms/{collection}/entries`) is in the path
 * and missing from the operation. Add it as a required string, so a tool still asks for
 * it.
 *
 * A callable route with `scope: null` is public and demands no key, so its operation
 * clears the document-wide `security` with an empty list.
 */
function addPathParameters(document: OpenApiDocument): OpenApiDocument {
  for (const [path, item] of Object.entries(document.paths)) {
    const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    for (const method of METHODS) {
      const operation = (item as Record<string, Operation | undefined>)[method];
      if (!operation) {
        continue;
      }
      const parameters = operation.parameters ?? [];
      for (const name of names) {
        if (
          name !== undefined &&
          !parameters.some((p) => p.in === "path" && p.name === name)
        ) {
          parameters.push({
            in: "path",
            name,
            required: true,
            schema: { type: "string" },
          });
        }
      }
      if (parameters.length > 0) {
        operation.parameters = parameters;
      }
      const agent = operation[AGENT_EXTENSION];
      if (agent?.callable === true && agent.scope === null) {
        operation.security = [];
      }
    }
  }
  return document;
}

const REF = "#/components/schemas/";

/** The body schema, with a `$ref` into the components followed one level. */
function bodySchema(
  operation: Operation,
  components: Record<string, unknown>
): Partial<ObjectSchema> | undefined {
  const schema = operation.requestBody?.content?.["application/json"]
    ?.schema as { $ref?: string } | undefined;
  if (schema?.$ref?.startsWith(REF)) {
    return components[schema.$ref.slice(REF.length)] as Partial<ObjectSchema>;
  }
  return schema as Partial<ObjectSchema> | undefined;
}

/**
 * Every callable operation of the document, as a tool with one flat input object.
 *
 * Path, query and body fields sit side by side, which is the shape an agent fills in
 * best. A name used in two places would make one of them unreachable, so it throws
 * instead, naming the tool; `pnpm test` builds the list and fails on it. Rename the
 * field, or keep the route closed.
 */
export function toolsFrom(document: OpenApiDocument): AgentTool[] {
  const components = (document.components.schemas ?? {}) as Record<
    string,
    unknown
  >;
  const tools: AgentTool[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = (item as Record<string, Operation | undefined>)[method];
      const agent = operation?.[AGENT_EXTENSION];
      if (!operation?.operationId || !agent?.callable) {
        continue;
      }
      const name = operation.operationId;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const place = (field: string, schema: unknown, needed: boolean) => {
        if (Object.hasOwn(properties, field)) {
          throw new Error(
            `agent: the tool ${name} takes "${field}" twice (path, query or body). Rename one of them.`
          );
        }
        properties[field] = schema ?? {};
        if (needed) {
          required.push(field);
        }
      };
      const pathParams: string[] = [];
      const queryParams: string[] = [];
      for (const parameter of operation.parameters ?? []) {
        if (parameter.in !== "path" && parameter.in !== "query") {
          continue;
        }
        place(
          parameter.name,
          parameter.schema,
          parameter.in === "path" || parameter.required === true
        );
        (parameter.in === "path" ? pathParams : queryParams).push(
          parameter.name
        );
      }
      const body = bodySchema(operation, components);
      if (body && body.type !== undefined && body.type !== "object") {
        throw new Error(
          `agent: the tool ${name} takes a ${String(body.type)} body; a tool's body must be an object.`
        );
      }
      const needed = new Set(body?.required);
      for (const [field, schema] of Object.entries(body?.properties ?? {})) {
        place(field, schema, needed.has(field));
      }
      tools.push({
        agent,
        description: operation.description ?? name,
        hasBody: body !== undefined,
        inputSchema: { properties, required, type: "object" },
        method: method.toUpperCase(),
        name,
        path,
        pathParams,
        queryParams,
      });
    }
  }
  return tools;
}

/** The tools of `app`, from its cached document. */
export async function agentTools(app: RoutedApp): Promise<AgentTool[]> {
  return toolsFrom(await openApiDocument(app));
}
