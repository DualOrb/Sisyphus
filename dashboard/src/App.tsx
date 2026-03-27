import { Routes, Route, Navigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { useSSE } from "./api/use-sse";
import { LiveMapPage } from "./pages/LiveMapPage";
import { OverviewPage } from "./pages/OverviewPage";
import { OrdersPage } from "./pages/OrdersPage";
import { DriversPage } from "./pages/DriversPage";
import { RestaurantsPage } from "./pages/RestaurantsPage";
import { MarketsPage } from "./pages/MarketsPage";
import { TicketsPage } from "./pages/TicketsPage";
import { EventFeedPage } from "./pages/EventFeedPage";
import { AuditPage } from "./pages/AuditPage";

export default function App() {
  const queryClient = useQueryClient();
  useSSE(queryClient);

  return (
    <Routes>
      {/* Full-screen live map — no sidebar layout */}
      <Route index element={<Navigate to="/live" replace />} />
      <Route path="live" element={<LiveMapPage />} />

      {/* Table/detail views with sidebar */}
      <Route element={<Layout />}>
        <Route path="overview" element={<OverviewPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="restaurants" element={<RestaurantsPage />} />
        <Route path="markets" element={<MarketsPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="events" element={<EventFeedPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
    </Routes>
  );
}
