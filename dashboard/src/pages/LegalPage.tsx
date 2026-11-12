import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Brand } from "../components/shared/Brand";
import { ThemeToggle } from "../components/shared/ThemeToggle";

type LegalKind = "privacy" | "terms";

interface LegalInfo {
  operator: string;
  contactEmail: string;
  publicBaseUrl: string;
}

const EFFECTIVE_DATE = "12 de novembro de 2026";
const GOOGLE_USER_DATA_POLICY = "https://developers.google.com/terms/api-services-user-data-policy";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

function Contact({ info }: { info: LegalInfo }) {
  if (!info.contactEmail) return <>o administrador desta instalação do Claudemar</>;
  return <a className="text-accent hover:underline" href={`mailto:${info.contactEmail}`}>{info.contactEmail}</a>;
}

function PrivacyPolicy({ info, operator }: { info: LegalInfo; operator: string }) {
  return (
    <>
      <Section title="1. Quem somos">
        <p>
          O Claudemar é um espaço de trabalho com agentes de inteligência artificial. {operator} é o responsável (controlador) pelos dados
          pessoais tratados nesta instalação{info.publicBaseUrl ? ` (${info.publicBaseUrl})` : ""}. Dúvidas e pedidos sobre privacidade: <Contact info={info} />.
        </p>
      </Section>

      <Section title="2. Dados que tratamos">
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Conta:</strong> nome, e-mail, token de acesso e, se você cadastrar, a chave pública da sua passkey.</li>
          <li><strong>Conteúdo que você envia:</strong> mensagens e pedidos aos agentes, arquivos, áudios (transcritos em texto), anexos e as respostas geradas.</li>
          <li>
            <strong>Serviços que você conecta, somente com a sua autorização:</strong>
            <ul className="list-[circle] pl-5 mt-1 space-y-1">
              <li>Google Gmail e Google Agenda (somente leitura), para alimentar o seu Second Brain;</li>
              <li>Google Drive, para espelhar as pastas que você compartilhar com um agente ou projeto e, quando você permitir, editar arquivos nelas;</li>
              <li>Slack e WhatsApp, apenas as conversas que você selecionar, para o seu Second Brain;</li>
              <li>Asana e Notion, para que um agente consulte e altere tarefas, páginas e bases em nome da conta que você vincular.</li>
            </ul>
          </li>
          <li><strong>Dados técnicos:</strong> registros de execução, horários, erros e métricas de uso necessários para operar e proteger o serviço.</li>
        </ul>
      </Section>

      <Section title="3. Para que usamos">
        <p>
          Usamos os dados apenas para prestar o serviço que você pediu: executar os agentes, organizar e pesquisar o seu Second Brain, manter a memória das
          conversas, sincronizar as pastas e realizar as ações solicitadas nos serviços conectados. Também usamos dados técnicos para segurança, prevenção de abuso
          e correção de falhas. Não vendemos dados, não os usamos para publicidade e não traçamos perfis para fins de marketing.
        </p>
        <p>As bases legais são a execução do contrato com você, o legítimo interesse em operar e proteger o serviço e, para os serviços conectados, o seu consentimento.</p>
      </Section>

      <Section title="4. Dados do Google">
        <p>
          O uso e a transferência de informações recebidas das APIs do Google para qualquer outro app pelo Claudemar seguem a{" "}
          <a className="text-accent hover:underline" href={GOOGLE_USER_DATA_POLICY} target="_blank" rel="noreferrer">Política de dados do usuário dos serviços de API do Google</a>,
          incluindo os requisitos de Uso Limitado. Em particular:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>os dados do Gmail, da Agenda e do Drive são usados somente para oferecer e melhorar os recursos visíveis a você descritos acima;</li>
          <li>não são transferidos a terceiros, exceto aos provedores listados na seção 5 e somente para prestar esses recursos, ou quando exigido por lei;</li>
          <li>não são usados para publicidade, não são vendidos e não são usados para treinar modelos de inteligência artificial de uso geral;</li>
          <li>nenhuma pessoa lê esses dados, exceto com o seu consentimento, por motivo de segurança, para cumprir a lei ou quando agregados e anonimizados para operar o serviço.</li>
        </ul>
      </Section>

      <Section title="5. Com quem compartilhamos">
        <p>Para funcionar, o Claudemar envia dados a provedores que agem por nossa conta, conforme os recursos ativados nesta instalação:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>provedores de modelos de IA (como Anthropic, OpenAI, Z.ai e Moonshot) para gerar as respostas dos agentes e processar o Second Brain;</li>
          <li>Voyage AI (busca semântica), Qdrant (índice de busca), Cloudflare (armazenamento de anexos) e TypeSafe (classificação da complexidade dos pedidos);</li>
          <li>OpenAI Whisper (transcrição de áudio), Telegram (bot de acesso), Amazon Web Services (envio de e-mails) e o provedor de infraestrutura que hospeda o serviço;</li>
          <li>os próprios serviços que você conectar (Google, Slack, WhatsApp, Asana, Notion), ao executar as ações que você ou o agente solicitarem.</li>
        </ul>
        <p>Alguns desses provedores ficam fora do Brasil. Nesses casos, a transferência internacional ocorre para a execução do serviço contratado, com as salvaguardas previstas na LGPD.</p>
      </Section>

      <Section title="6. Armazenamento e segurança">
        <p>
          Os dados trafegam por conexões criptografadas (HTTPS). O acesso ao painel exige token pessoal ou passkey, e cada usuário só acessa os projetos, agentes e
          o Second Brain liberados para ele. As autorizações de serviços conectados ficam armazenadas no servidor e nunca são exibidas no navegador. Nenhum sistema
          é totalmente imune a falhas; se houver incidente que possa causar risco relevante, avisaremos os afetados e a ANPD.
        </p>
      </Section>

      <Section title="7. Retenção e exclusão">
        <p>
          Mantemos os dados enquanto sua conta estiver ativa ou enquanto forem necessários para a finalidade de cada recurso. Ao desconectar um serviço, a autorização
          é revogada e o Claudemar deixa de acessá-lo; ao remover uma pasta do Drive, a cópia local é apagada. Quando sua conta é excluída, apagamos o seu Second Brain
          e as contas que você conectou. Registros técnicos podem ser mantidos pelo prazo exigido por lei. Você pode pedir a exclusão a qualquer momento pelo contato acima.
        </p>
      </Section>

      <Section title="8. Seus direitos">
        <p>
          Pela LGPD, você pode pedir confirmação do tratamento, acesso, correção, anonimização, bloqueio ou eliminação, portabilidade, informações sobre
          compartilhamento e a revogação do consentimento. Também pode revogar o acesso do Claudemar diretamente nas configurações de segurança do Google,
          Slack, Asana ou Notion. Pedidos: <Contact info={info} />. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
      </Section>

      <Section title="9. Cookies e armazenamento local">
        <p>
          Usamos apenas o armazenamento local do navegador para manter sua sessão e preferências, e cookies técnicos temporários para proteger as conexões com
          serviços externos. Não usamos cookies de publicidade nem de rastreamento.
        </p>
      </Section>

      <Section title="10. Alterações">
        <p>Podemos atualizar esta política. A data de vigência no topo indica a versão atual; mudanças relevantes serão avisadas no próprio Claudemar.</p>
      </Section>
    </>
  );
}

function TermsOfService({ info, operator }: { info: LegalInfo; operator: string }) {
  return (
    <>
      <Section title="1. Aceite">
        <p>
          Estes termos regem o uso do Claudemar oferecido por {operator}. Ao acessar o serviço, você concorda com eles e com a{" "}
          <Link className="text-accent hover:underline" to="/privacidade">Política de Privacidade</Link>. Se não concordar, não use o serviço.
        </p>
      </Section>

      <Section title="2. O serviço">
        <p>
          O Claudemar oferece agentes de inteligência artificial, projetos, memória, Second Brain e integrações com serviços de terceiros. O acesso é feito por convite,
          com token pessoal ou passkey, e os recursos disponíveis dependem das permissões definidas pelo administrador.
        </p>
      </Section>

      <Section title="3. Sua conta">
        <p>
          O acesso é pessoal e intransferível. Guarde seu token em segurança e avise o administrador se suspeitar de uso indevido. Você responde pelas atividades
          realizadas com o seu acesso.
        </p>
      </Section>

      <Section title="4. Uso aceitável">
        <p>Você se compromete a não usar o serviço para:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>violar a lei ou direitos de terceiros, incluindo privacidade e propriedade intelectual;</li>
          <li>acessar sistemas, contas ou dados sem autorização, ou contornar os limites de acesso do Claudemar;</li>
          <li>distribuir malware, spam ou conteúdo ilegal, ou sobrecarregar a infraestrutura de forma intencional;</li>
          <li>conectar contas ou enviar dados de terceiros sem ter autorização para isso.</li>
        </ul>
      </Section>

      <Section title="5. Serviços conectados e ações dos agentes">
        <p>
          Ao conectar uma conta (Google, Slack, WhatsApp, Asana, Notion ou outras) e vinculá-la a um agente, você autoriza o agente a ler e, quando permitido, alterar
          dados nesse serviço em seu nome. A conta vinculada a um agente é usada em todas as conversas e agendamentos dele, inclusive quando outra pessoa com acesso ao
          agente o utiliza. Você pode remover o vínculo ou desconectar a conta a qualquer momento. O uso desses serviços também está sujeito aos termos de cada provedor.
        </p>
      </Section>

      <Section title="6. Conteúdo gerado por IA">
        <p>
          As respostas e ações dos agentes são geradas automaticamente e podem conter erros, omissões ou informações desatualizadas. Revise o resultado antes de usá-lo
          em decisões importantes, em produção ou em comunicações com terceiros. Você mantém os direitos sobre o conteúdo que envia e sobre o que for gerado para você,
          e é responsável pelo uso que fizer dele.
        </p>
      </Section>

      <Section title="7. Disponibilidade">
        <p>
          Buscamos manter o serviço estável, mas ele é oferecido no estado em que se encontra, sem garantia de funcionamento ininterrupto ou livre de erros. Recursos podem
          ser alterados, suspensos ou encerrados, inclusive por mudanças nos serviços de terceiros dos quais o Claudemar depende.
        </p>
      </Section>

      <Section title="8. Responsabilidade">
        <p>
          Na extensão permitida pela lei, {operator} não responde por danos indiretos, lucros cessantes ou perda de dados decorrentes do uso do serviço, de falhas de
          terceiros ou de ações executadas pelos agentes a pedido dos usuários. Nada nestes termos limita direitos que a lei garante e que não podem ser afastados.
        </p>
      </Section>

      <Section title="9. Suspensão e encerramento">
        <p>
          O acesso pode ser suspenso ou encerrado em caso de violação destes termos, risco à segurança ou por decisão do administrador. Você pode deixar de usar o serviço
          e pedir a exclusão dos seus dados a qualquer momento, conforme a Política de Privacidade.
        </p>
      </Section>

      <Section title="10. Alterações e lei aplicável">
        <p>
          Podemos atualizar estes termos; mudanças relevantes serão avisadas no próprio Claudemar, e continuar usando o serviço significa aceitar a nova versão. Estes termos
          seguem as leis do Brasil. Contato: <Contact info={info} />.
        </p>
      </Section>
    </>
  );
}

export function LegalPage({ kind }: { kind: LegalKind }) {
  const [info, setInfo] = useState<LegalInfo | null>(null);
  const title = kind === "privacy" ? "Política de Privacidade" : "Termos de Serviço";

  useEffect(() => {
    document.title = `${title} · Claudemar`;
  }, [title]);

  useEffect(() => {
    fetch("/api/legal")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: LegalInfo) => setInfo(data))
      .catch(() => setInfo({ operator: "", contactEmail: "", publicBaseUrl: "" }));
  }, []);

  const operator = info?.operator || "o administrador desta instalação do Claudemar";

  return (
    <div className="login-page">
      <header className="login-header">
        <Link to="/login" aria-label="Voltar ao login"><Brand /></Link>
        <ThemeToggle />
      </header>
      <main className="legal-main">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-accent">
          <ArrowLeft size={13} /> Voltar ao login
        </Link>
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
          <p className="text-xs text-text-muted">Vigente desde {EFFECTIVE_DATE}</p>
        </header>
        {info ? (
          <div className="space-y-8 text-sm leading-relaxed text-text-secondary">
            {kind === "privacy" ? <PrivacyPolicy info={info} operator={operator} /> : <TermsOfService info={info} operator={operator} />}
          </div>
        ) : (
          <p role="status" className="text-sm text-text-muted">Carregando…</p>
        )}
      </main>
      <footer className="login-footer">
        <span>Claudemar</span>
        <nav className="legal-links" aria-label="Documentos legais">
          <Link to="/privacidade">Política de Privacidade</Link>
          <Link to="/termos">Termos de Serviço</Link>
        </nav>
      </footer>
    </div>
  );
}
