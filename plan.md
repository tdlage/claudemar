# Plano: Isolamento Docker Devcontainer para Projetos

## Objetivo
Execuções Claude CLI de **projetos** (não agentes, não orchestrator) rodam dentro de containers Docker efêmeros, usando a imagem de referência do devcontainer do Claude Code com firewall iptables.

## Arquitetura

Cada execução de projeto:
1. `docker run --rm` com a imagem devcontainer
2. Volume bind do diretório do projeto → `/workspace`
3. Volume bind read-only do `~/.claude` → `/home/node/.claude` (para credenciais/sessões)
4. Firewall init via `postStartCommand` (NET_ADMIN capability)
5. Executa `claude` com os mesmos args de hoje
6. SIGTERM no processo docker mata o container (--rm limpa)

Quando Docker não está habilitado ou `targetType !== "project"`, comportamento atual é mantido (zero breaking changes).

## Mudanças

### 1. `src/config.ts` — Novas env vars
```
DOCKER_ENABLED=true|false (default: false)
DOCKER_IMAGE=string (default: "node:20" — build custom)
```
Adicionar:
- `dockerEnabled: process.env.DOCKER_ENABLED === "true"`
- `dockerImage: process.env.DOCKER_IMAGE || ""`

### 2. Criar `src/docker-manager.ts` — Gerenciamento de imagem
Responsabilidades:
- `ensureImage()` — na inicialização, se `dockerEnabled`, faz `docker build` da imagem baseada no Dockerfile de referência do Claude Code (copiado para `.devcontainer/` no basePath)
- `buildDockerArgs(hostCwd, claudeArgs)` — monta os args do `docker run`:
  - `--rm` (efêmero)
  - `--cap-add=NET_ADMIN --cap-add=NET_RAW` (para firewall)
  - `-v ${hostCwd}:/workspace` (bind mount do projeto)
  - `-v ${claudeConfigDir}:/home/node/.claude` (credenciais Claude — sessões, OAuth)
  - `-w /workspace`
  - `-u node` (non-root, como no devcontainer de referência)
  - `-e NODE_OPTIONS=--max-old-space-size=4096`
  - A imagem configurada
  - `bash -c "sudo /usr/local/bin/init-firewall.sh && claude ${claudeArgs}"`

### 3. `src/executor.ts` — Adicionar flag `useDocker` ao `spawnClaude`
Quando `useDocker === true`:
- Em vez de `spawn("claude", args, { cwd })`, faz `spawn("docker", dockerRunArgs)`
- O `cwd` do spawn do Node não importa (docker -w cuida)
- Os args do claude são passados dentro do container
- stdio continua `["ignore", "pipe", "pipe"]` — streaming JSON funciona igual

### 4. `src/execution-manager.ts` — Passar `useDocker` para `spawnClaude`
No `startExecution()`:
- `const useDocker = opts.targetType === "project" && config.dockerEnabled;`
- Passar para `spawnClaude`
- Ajustar `systemSuffix`: quando `useDocker`, o path de confinamento é `/workspace` (não o path do host)

### 5. Criar `.devcontainer/` no basePath — Dockerfile + init-firewall.sh
Na inicialização (docker-manager.ts), se `dockerEnabled`:
- Copiar o `Dockerfile` e `init-firewall.sh` de referência para `${basePath}/.devcontainer/`
- Fazer `docker build -t claudemar-devcontainer ${basePath}/.devcontainer/`
- Imagem padrão fica `claudemar-devcontainer` se `DOCKER_IMAGE` não especificado

### 6. Tela de toggle no Dashboard (ProjectDetailPage)
- Adicionar toggle "Docker" ao lado de "Queue" e "Plan" nos controles do projeto
- Estado salvo em `useCachedState`
- Enviar `useDocker: true` no body do POST /executions
- Backend: respeitar o flag por request (além do config global)

## Fluxo completo

```
POST /executions { targetType: "project", targetName: "app", prompt: "..." }
  │
  ├─ config.dockerEnabled && body.useDocker !== false
  │     │
  │     └─ docker run --rm --cap-add=NET_ADMIN --cap-add=NET_RAW \
  │          -v /data/projects/app:/workspace \
  │          -v ~/.claude:/home/node/.claude \
  │          -w /workspace \
  │          claudemar-devcontainer \
  │          bash -c "sudo /usr/local/bin/init-firewall.sh && claude --print --verbose ..."
  │
  └─ else: spawn("claude", args, { cwd }) (como hoje)
```

## Arquivos a criar/editar

| Arquivo | Ação |
|---------|------|
| `src/config.ts` | Adicionar `dockerEnabled`, `dockerImage` |
| `src/docker-manager.ts` | **Novo** — build imagem, montar docker args |
| `src/executor.ts` | Adicionar param `useDocker`, branch docker/nativo |
| `src/execution-manager.ts` | Calcular `useDocker`, ajustar systemSuffix |
| `src/server/routes/executions.ts` | Extrair `useDocker` do body |
| `src/main.ts` | Chamar `ensureImage()` na inicialização |
| `dashboard/src/pages/ProjectDetailPage.tsx` | Toggle Docker |
