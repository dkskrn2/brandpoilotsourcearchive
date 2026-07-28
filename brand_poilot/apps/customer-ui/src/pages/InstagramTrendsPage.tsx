import { Navigate, useLocation } from "react-router-dom";

export function InstagramTrendsPage() {
  const query = new URLSearchParams(useLocation().search);
  query.set("view", "trends");
  return <Navigate to={`/references?${query.toString()}`} replace />;
}
