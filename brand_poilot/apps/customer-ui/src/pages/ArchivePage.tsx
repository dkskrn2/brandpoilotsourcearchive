import { Navigate, useLocation } from "react-router-dom";

export function ArchivePage() {
  const query = new URLSearchParams(useLocation().search);
  query.set("view", "saved-trends");
  return <Navigate to={`/references?${query.toString()}`} replace />;
}
