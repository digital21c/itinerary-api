import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./app-env";
import type { Repositories } from "./repositories/types";
import { documentRoutes } from "./routes/documents";
import { keyRoutes } from "./routes/keys";
import { publicationRoutes } from "./routes/publications";
import { problemResponse } from "./utils/problem";

/**
 * Builds the app. The repositories come from a factory, called per request with that
 * request's bindings, so routes only ever see the repository interfaces.
 */
export function createApp(getRepositories: (env: Env) => Repositories): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Bearer keys, not cookies: CORS protects nothing here, so any origin may call the API.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowHeaders: ["Authorization", "Content-Type", "If-Match", "If-None-Match"],
      exposeHeaders: ["ETag", "Location"],
      maxAge: 86400,
    }),
  );

  app.use("*", async (c, next) => {
    c.set("repositories", getRepositories(c.env));
    await next();
  });

  app.route("/v1/documents", documentRoutes);
  app.route("/v1/documents", publicationRoutes);
  app.route("/v1/documents", keyRoutes);

  app.notFound(() => problemResponse({ status: 404, title: "Not Found" }));

  // Logs only the error itself, never the request, so a key can't reach the logs this way.
  app.onError((error) => {
    console.error(
      JSON.stringify({ event: "unhandled-error", name: error.name, message: error.message }),
    );
    return problemResponse({ status: 500, title: "Internal Server Error" });
  });

  return app;
}
