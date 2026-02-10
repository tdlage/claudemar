import { Outlet } from "react-router-dom";
import { Sidebar, SidebarProvider, useSidebar } from "./Sidebar";
import { Header } from "./Header";
import { CommandPalette } from "../CommandPalette";

function LayoutInner() {
  const { collapsed } = useSidebar();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div
        className={`flex-1 min-w-0 overflow-hidden transition-[margin-left] duration-200 ${
          collapsed ? "ml-14" : "ml-56"
        }`}
      >
        <Header />
        <main className="p-4 md:p-6 overflow-hidden">
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
