import { useNavigate } from "react-router-dom";
import { Brain } from "lucide-react";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { useGoogleAccounts } from "../../hooks/useBrain";
import { useToast } from "../shared/Toast";

export function FirstRunCta({ configured }: { configured: boolean }) {
  const navigate = useNavigate();
  const { connect } = useGoogleAccounts();
  const { addToast } = useToast();

  return (
    <div className="flex justify-center py-12">
      <Card className="max-w-md text-center space-y-4 p-8">
        <Brain size={32} className="mx-auto text-accent" />
        <h2 className="text-base font-semibold text-text-primary">Comece conectando o Google</h2>
        <p className="text-sm text-text-secondary">
          O Second Brain ingere email e calendário das suas contas (pessoal e de cada empresa), guarda tudo em
          markdown versionado e compila conhecimento num wiki. Conecte a primeira conta Google para iniciar.
        </p>
        {configured ? (
          <Button
            onClick={async () => {
              const result = await connect();
              if (!result.ok) addToast("error", result.error ?? "Falha ao iniciar autorização");
            }}
          >
            Conectar Google
          </Button>
        ) : (
          <p className="text-sm text-warning">
            Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET primeiro (Settings → Variáveis de ambiente).
          </p>
        )}
        <button
          onClick={() => navigate("/second-brain/settings")}
          className="text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          Abrir Configurações
        </button>
      </Card>
    </div>
  );
}
