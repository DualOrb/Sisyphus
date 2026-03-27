import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export function useOverview() {
  return useQuery({ queryKey: ["overview"], queryFn: api.overview });
}

export function useOrders(params?: { status?: string; zone?: string }) {
  return useQuery({
    queryKey: ["orders", params],
    queryFn: () => api.orders(params),
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ["order", id],
    queryFn: () => api.order(id),
    enabled: !!id,
  });
}

export function useDrivers(params?: { zone?: string; status?: string }) {
  return useQuery({
    queryKey: ["drivers", params],
    queryFn: () => api.drivers(params),
  });
}

export function useRestaurants(params?: { zone?: string; open?: string }) {
  return useQuery({
    queryKey: ["restaurants", params],
    queryFn: () => api.restaurants(params),
  });
}

export function useMarkets() {
  return useQuery({ queryKey: ["markets"], queryFn: api.markets });
}

export function useTickets(params?: { status?: string }) {
  return useQuery({
    queryKey: ["tickets", params],
    queryFn: () => api.tickets(params),
  });
}

export function useAudit(limit?: number) {
  return useQuery({
    queryKey: ["audit", limit],
    queryFn: () => api.audit(limit),
  });
}
