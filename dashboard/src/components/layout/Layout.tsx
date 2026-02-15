import { Outlet } from "react-router-dom";
import { Sidebar, SidebarProvider, useSidebar } from "./Sidebar";
import { Header } from "./Header";
import { CommandPalette } from "../CommandPalette";

function LayoutInner() {
  const { collapsed, isMobile } = useSidebar();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div
        className={`flex-1 min-w-0 flex flex-col overflow-hidden transition-[margin-left] duration-200 ${
          isMobile ? "ml-0" : collapsed ? "ml-14" : "ml-56"
        }`}
      >
        <Header />
        <main className="flex-1 min-h-0 p-3 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
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
