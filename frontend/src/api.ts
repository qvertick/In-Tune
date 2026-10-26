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
    try {
      const body = await response.json();
      detail =
        typeof body.detail === "string"
          ? body.detail
          : Array.isArray(body.detail)
            ? body.detail
                .slice(0, 3)
                .map(
                  (item: { msg?: string }) =>
                    item.msg || "Недопустимое значение",
                )
                .join(". ")
            : "";
    } catch {
      /* Non-JSON errors still expose their status. */
    }
    throw new Error(detail || `Сервер ответил ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
