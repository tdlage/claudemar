import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { OrchestratorPage } from "./pages/OrchestratorPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { EditorPage } from "./pages/EditorPage";
import { LogsPage } from "./pages/LogsPage";

function KeyedProjectPage() {
  const { name } = useParams();
  return <ProjectDetailPage key={name} />;
}

function KeyedAgentPage() {
  const { name } = useParams();
  return <AgentDetailPage key={name} />;
}

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
      { path: "agents/:name", element: <KeyedAgentPage /> },
      { path: "projects/:name", element: <KeyedProjectPage /> },
      { path: "editor", element: <EditorPage /> },
      { path: "logs", element: <LogsPage /> },
    ],
  },
]);
