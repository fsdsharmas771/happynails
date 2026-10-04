/** Error with the API's stable code, so screens can react to specific failures. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const res = await fetch(`/api/admin${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      // Required by the API on every change; cross-site requests cannot set it.
      "x-hn-admin": "1",
      Accept: "application/json",
      ...(body !== undefined && !form ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? res.statusText,
      err?.details,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => call<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => call<T>("PUT", path, body),
  del: (path: string) => call<void>("DELETE", path),
  upload: (file: File, kind: "image" | "video") => {
    const fd = new FormData();
    fd.append("file", file);
    return call<{ url: string }>("POST", `/uploads?kind=${kind}`, fd);
  },
};

/** Readable message for a failed request, including field errors from validation. */
export function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Please try again.";
  if (err.code === "VALIDATION_ERROR" && Array.isArray(err.details)) {
    return err.details
      .map(
        (i: { path?: (string | number)[]; message?: string }) =>
          `${(i.path ?? []).join(".") || "input"}: ${i.message}`,
      )
      .join("; ");
  }
  return err.message;
}
