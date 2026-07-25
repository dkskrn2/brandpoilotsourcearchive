import { AppShell } from "./components/layout/AppShell";
import { BrandSetupGate } from "./components/layout/BrandSetupGate";
import { AuthGate } from "./lib/auth";

export function App() {
  return (
    <AuthGate><AppShell><BrandSetupGate /></AppShell></AuthGate>
  );
}
