const BASE = "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  overview: () => get<any>("/api/overview"),
  orders: (params?: { status?: string; zone?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.zone) q.set("zone", params.zone);
    const qs = q.toString();
    return get<any[]>(`/api/orders${qs ? `?${qs}` : ""}`);
  },
  order: (id: string) => get<any>(`/api/orders/${id}`),
  drivers: (params?: { zone?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.zone) q.set("zone", params.zone);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return get<any[]>(`/api/drivers${qs ? `?${qs}` : ""}`);
  },
  restaurants: (params?: { zone?: string; open?: string }) => {
    const q = new URLSearchParams();
    if (params?.zone) q.set("zone", params.zone);
    if (params?.open) q.set("open", params.open);
    const qs = q.toString();
    return get<any[]>(`/api/restaurants${qs ? `?${qs}` : ""}`);
  },
  markets: () => get<any[]>("/api/markets"),
  tickets: (params?: { status?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return get<any[]>(`/api/tickets${qs ? `?${qs}` : ""}`);
  },
  conversations: (params?: { unread?: string }) => {
    const q = new URLSearchParams();
    if (params?.unread) q.set("unread", params.unread);
    const qs = q.toString();
    return get<any[]>(`/api/conversations${qs ? `?${qs}` : ""}`);
  },
  audit: (limit?: number) =>
    get<any[]>(`/api/audit${limit ? `?limit=${limit}` : ""}`),
};
