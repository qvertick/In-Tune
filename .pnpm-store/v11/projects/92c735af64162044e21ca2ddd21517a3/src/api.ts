/** Raw diagnostics are retained independently of the current display language. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly detail?: unknown,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      ...(typeof options?.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    let detail = "";
    let code: string | undefined;
    let rawDetail: unknown;
    try {
      const body = await response.json();
      rawDetail = body;
      code = typeof body.error?.code === "string" ? body.error.code : undefined;
      detail =
        typeof body.error?.message === "string"
          ? body.error.message
          : typeof body.detail === "string"
            ? body.detail
            : Array.isArray(body.detail)
              ? body.detail
                  .map(
                    (item: { msg?: string }) =>
                      item.msg || "Недопустимое значение",
                  )
                  .join(". ")
              : "";
    } catch {
      /* Non-JSON errors still expose their status. */
    }
    throw new ApiError(
      detail || `Сервер ответил ${response.status}`,
      response.status,
      code,
      rawDetail,
      /^\d+$/.test(response.headers.get("Retry-After") ?? "")
        ? Number(response.headers.get("Retry-After"))
        : undefined,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
