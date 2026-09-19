import { lazy } from "react";
import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { LoginPage } from "./pages/LoginPage";
import { getMe } from "./hooks/useAuth";
import { RouteError } from "./components/shared/RouteError";

const OverviewPage = lazy(() => import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const OrchestratorPage = lazy(() => import("./pages/OrchestratorPage").then((module) => ({ default: module.OrchestratorPage })));
const AgentDetailPage = lazy(() => import("./pages/AgentDetailPage").then((module) => ({ default: module.AgentDetailPage })));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage").then((module) => ({ default: module.ProjectDetailPage })));
const LogsPage = lazy(() => import("./pages/LogsPage").then((module) => ({ default: module.LogsPage })));
const ChangelogPage = lazy(() => import("./pages/ChangelogPage").then((module) => ({ default: module.ChangelogPage })));
const UsersPage = lazy(() => import("./pages/UsersPage").then((module) => ({ default: module.UsersPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const TrackerPage = lazy(() => import("./pages/TrackerPage").then((module) => ({ default: module.TrackerPage })));
const SecondBrainPage = lazy(() => import("./pages/SecondBrainPage").then((module) => ({ default: module.SecondBrainPage })));
const WorkspacesPage = lazy(() => import("./pages/WorkspacesPage").then((module) => ({ default: module.WorkspacesPage })));

function KeyedBrainPage() {
  const { tab } = useParams();
  return <SecondBrainPage key={tab} />;
}

function KeyedTrackerPage() {
  const { projectId, cycleId, itemId } = useParams();
  return <TrackerPage key={`${projectId}-${cycleId}-${itemId}`} />;
}

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

function NoAccessPage() {
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-text-muted text-sm">Você ainda não tem projetos ou agentes disponíveis. Peça ao administrador para liberar seu acesso.</p>
    </div>
  );
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const me = getMe();
  if (me && me.role === "user") {
    const first = me.projects[0] || me.agents[0];
    if (first) {
      const prefix = me.projects[0] ? "projects" : "agents";
      return <Navigate to={`/${prefix}/${first}`} replace />;
    }
    return <NoAccessPage />;
  }
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
    errorElement: <RouteError />,
  },
  {
    path: "/",
    element: (
      <AuthGuard>
        <Layout />
      </AuthGuard>
    ),
    errorElement: <RouteError />,
    children: [{ errorElement: <RouteError />, children: [
      { index: true, element: <AdminGuard><OverviewPage /></AdminGuard> },
      { path: "orchestrator", element: <AdminGuard><OrchestratorPage /></AdminGuard> },
      { path: "second-brain", element: <AdminGuard><SecondBrainPage /></AdminGuard> },
      { path: "second-brain/:tab", element: <AdminGuard><KeyedBrainPage /></AdminGuard> },
      { path: "second-brain/:tab/*", element: <AdminGuard><KeyedBrainPage /></AdminGuard> },
      { path: "agents/:name", element: <KeyedAgentPage /> },
      { path: "workspaces", element: <WorkspacesPage /> },
      { path: "workspaces/:kind", element: <WorkspacesPage /> },
      { path: "projects/:name", element: <KeyedProjectPage /> },
      { path: "logs", element: <AdminGuard><LogsPage /></AdminGuard> },
      { path: "changelog", element: <AdminGuard><ChangelogPage /></AdminGuard> },
      { path: "users", element: <AdminGuard><UsersPage /></AdminGuard> },
      { path: "settings", element: <AdminGuard><SettingsPage /></AdminGuard> },
      { path: "tracker", element: <TrackerPage /> },
      { path: "tracker/:projectId", element: <KeyedTrackerPage /> },
      { path: "tracker/:projectId/board", element: <KeyedTrackerPage /> },
      { path: "tracker/:projectId/cycles/:cycleId", element: <KeyedTrackerPage /> },
      { path: "tracker/:projectId/cycles/:cycleId/items/:itemId", element: <KeyedTrackerPage /> },
      { path: "*", element: <RouteError notFound /> },
    ] }],
  },
]);
