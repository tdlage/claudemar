import { Suspense, useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar, SidebarProvider, useSidebar } from "./Sidebar";
import { Header } from "./Header";
import { CommandPalette } from "../CommandPalette";
import { ApiKeysSetup } from "./ApiKeysSetup";
import { ClaudeAuthBanner } from "./ClaudeAuthBanner";
import { MobileNavigation } from "./MobileNavigation";
import { useMobileViewport } from "../../hooks/useMobile";

import { CreateWorkspaceModal } from "../shared/CreateWorkspaceModal";
import { LoadingState } from "../shared/PageState";
import { ConnectionStatus } from "./ConnectionStatus";

function LayoutInner() {
  useMobileViewport();
  const { collapsed, isMobile } = useSidebar();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [pathname]);

  return (
    <div className="app-shell flex overflow-hidden">
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>
      <Sidebar />
      <div
        className={`app-content flex-1 min-w-0 flex flex-col overflow-hidden transition-[margin-left] duration-200 ${
          isMobile ? "ml-0" : collapsed ? "sidebar-compact" : "sidebar-expanded"
        }`}
      >
        <ClaudeAuthBanner />
        <Header />
        <ConnectionStatus />
        <main
          ref={mainRef}
          tabIndex={-1}
          id="main-content"
          className="app-main flex-1 min-h-0 min-w-0 p-4 md:p-6 overflow-auto"
        >
          <Suspense fallback={<LoadingState label="Carregando página…" />}>
            <Outlet />
          </Suspense>
        </main>
        <MobileNavigation />
      </div>
      <CommandPalette />
      <ApiKeysSetup />
      <CreateWorkspaceModal />
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
