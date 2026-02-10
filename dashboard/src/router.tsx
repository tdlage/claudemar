import { createBrowserRouter, Navigate } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { OrchestratorPage } from "./pages/OrchestratorPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { EditorPage } from "./pages/EditorPage";
import { LogsPage } from "./pages/LogsPage";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("dashboard_token");
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/",
    element: (
      <AuthGuard>
        <Layout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "orchestrator", element: <OrchestratorPage /> },
      { path: "agents/:name", element: <AgentDetailPage /> },
      { path: "projects/:name", element: <ProjectDetailPage /> },
      { path: "editor", element: <EditorPage /> },
      { path: "logs", element: <LogsPage /> },
    ],
  },
]);
