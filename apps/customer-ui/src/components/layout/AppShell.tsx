import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { BrandStatusProvider } from "../../lib/brandStatus";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <BrandStatusProvider>
      <div className="app">
        <Sidebar />
        <main className="main">
          <Topbar />
          {children}
        </main>
      </div>
    </BrandStatusProvider>
  );
}
