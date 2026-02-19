import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { OrchestratorPage } from "./pages/OrchestratorPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { LogsPage } from "./pages/LogsPage";
import { ChangelogPage } from "./pages/ChangelogPage";
import { UsersPage } from "./pages/UsersPage";
import { getMe } from "./hooks/useAuth";

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

function AdminGuard({ children }: { children: React.ReactNode }) {
  const me = getMe();
  if (me && me.role === "user") {
    const first = me.projects[0] || me.agents[0];
    if (first) {
      const prefix = me.projects[0] ? "projects" : "agents";
      return <Navigate to={`/${prefix}/${first}`} replace />;
    }
    return <Navigate to="/login" replace />;
  }
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
      { index: true, element: <AdminGuard><OverviewPage /></AdminGuard> },
      { path: "orchestrator", element: <AdminGuard><OrchestratorPage /></AdminGuard> },
      { path: "agents/:name", element: <KeyedAgentPage /> },
      { path: "projects/:name", element: <KeyedProjectPage /> },
      { path: "logs", element: <AdminGuard><LogsPage /></AdminGuard> },
      { path: "changelog", element: <AdminGuard><ChangelogPage /></AdminGuard> },
      { path: "users", element: <AdminGuard><UsersPage /></AdminGuard> },
    ],
  },
]);
