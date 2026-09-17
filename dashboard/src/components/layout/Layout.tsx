import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar, SidebarProvider, useSidebar } from "./Sidebar";
import { Header } from "./Header";
import { CommandPalette } from "../CommandPalette";
import { ApiKeysSetup } from "./ApiKeysSetup";
import { ClaudeAuthBanner } from "./ClaudeAuthBanner";
import { MobileNavigation } from "./MobileNavigation";
import { useMobileViewport } from "../../hooks/useMobile";

function LayoutInner() {
  useMobileViewport();
  const { collapsed, isMobile } = useSidebar();

  return (
    <div className="app-shell flex overflow-hidden">
      <Sidebar />
      <div
        className={`flex-1 min-w-0 flex flex-col overflow-hidden transition-[margin-left] duration-200 ${
          isMobile ? "ml-0" : collapsed ? "ml-14" : "ml-56"
        }`}
      >
        <ClaudeAuthBanner />
        <Header />
        <main id="main-content" className="app-main flex-1 min-h-0 min-w-0 p-4 md:p-6 overflow-auto">
          <Suspense fallback={<p role="status" className="py-8 text-sm text-text-secondary">Carregando página…</p>}><Outlet /></Suspense>
        </main>
        <MobileNavigation />
      </div>
      <CommandPalette />
      <ApiKeysSetup />
    </div>
  );
}

export function Layout() {
  return (
    <SidebarProvider>
      <LayoutInner />
    </SidebarProvider>
  );
}
