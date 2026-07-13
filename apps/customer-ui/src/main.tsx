import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { canonicalLocalDevUrl } from "./lib/localOrigin";
import "./styles/prototype.css";

const canonicalUrl = canonicalLocalDevUrl(window.location);

if (canonicalUrl) {
  window.location.replace(canonicalUrl);
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </React.StrictMode>
  );
}
