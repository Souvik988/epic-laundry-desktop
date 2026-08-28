// When served at /ui/app/, the API is at ../../api relative to origin root.
const BASE = "/api";

type RequestOptions = { idempotencyKey?: string };

const idempotencyKey = () => crypto.randomUUID();
const notifyUnauthorized = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('epic-auth-expired'));
};

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { credentials: "same-origin" });
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: any, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Idempotency-Key": options.idempotencyKey || idempotencyKey() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `POST ${path} -> ${res.status}`);
  }
  return res.json();
}

export async function apiPatch<T = any>(path: string, body?: any): Promise<T> {
  const res = await fetch(BASE + path, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `PATCH ${path} -> ${res.status}`);
  }
  return res.json();
}

// Convenience for entity CRUD
export const listEntity = <T = any>(entity: string) => apiGet<T[]>(`/${entity}`);
export const createEntity = <T = any>(entity: string, data: any) => apiPost<T>(`/${entity}`, { data });
