import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

export default app;
