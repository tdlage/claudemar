import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";
import {
  ArrowLeft,
  FileQuestion,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "./Button";

export function RouteError({ notFound = false }: { notFound?: boolean }) {
  const error = useRouteError();
  const missing =
    notFound || (isRouteErrorResponse(error) && error.status === 404);
  return (
    <div className="route-error" role={missing ? undefined : "alert"}>
      {missing ? (
        <FileQuestion size={36} className="text-accent" />
      ) : (
        <TriangleAlert size={36} className="text-warning" />
      )}
      <p className="eyebrow">
        {missing
          ? "404 / Página não encontrada"
          : "Não foi possível abrir esta página"}
      </p>
      <h1>
        {missing
          ? "Vamos encontrar o caminho de volta."
          : "Algo interrompeu o carregamento."}
      </h1>
      <p>
        {missing
          ? "O endereço pode ter mudado ou não existir. Volte ao início para acessar seus espaços."
          : "Recarregue a página para tentar novamente. Se o problema continuar, entre em contato com o administrador."}
      </p>
      <div className="flex flex-wrap justify-center gap-3 mt-2">
        <Link to="/" className="dt-button dt-button--secondary">
          <ArrowLeft size={16} /> Voltar ao início
        </Link>
        {!missing && (
          <Button onClick={() => window.location.reload()}>
            <RefreshCw size={16} /> Recarregar página
          </Button>
        )}
      </div>
    </div>
  );
}
