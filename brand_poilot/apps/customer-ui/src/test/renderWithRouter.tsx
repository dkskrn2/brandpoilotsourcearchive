import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { App } from "../App";

export function renderWithRouter(path = "/onboarding") {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <App />,
        children: [{ path: "*", element: <div>Test page</div> }]
      }
    ],
    {
      initialEntries: [path],
      future: {
        v7_relativeSplatPath: true
      }
    }
  );

  return render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
}
