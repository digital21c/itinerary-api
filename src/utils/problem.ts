/**
 * Problem Details (RFC 9457) error responses, `application/problem+json`.
 *
 * `type` is `about:blank` when the status code says everything (RFC 9457's default), and a
 * relative `/problems/…` URI for problems a client needs to tell apart.
 */

export interface Problem {
  status: number;
  title: string;
  type?: string;
  detail?: string;
}

export function problemResponse(problem: Problem, headers?: HeadersInit): Response {
  const body = {
    type: problem.type ?? "about:blank",
    title: problem.title,
    status: problem.status,
    ...(problem.detail === undefined ? {} : { detail: problem.detail }),
  };
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/problem+json");
  return new Response(JSON.stringify(body), { status: problem.status, headers: responseHeaders });
}
