import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { GameLauncher } from "../game/GameLauncher";
import type { CourseState, ExerciseView, LessonView, QuestionView, TeacherOverview } from "./types";

const { socket, api, addToast } = vi.hoisted(() => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  api: { get: vi.fn(), post: vi.fn() },
  addToast: vi.fn(),
}));
vi.mock("../../lib/socket", () => ({ getSocket: () => socket }));
vi.mock("../../lib/api", () => ({ api, ApiError: class extends Error {} }));
vi.mock("../shared/Toast", () => ({ useToast: () => ({ addToast }) }));

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const course = {
  current: { unit: 9, step: 2 },
  furthest: { unit: 9, step: 2 },
  totalUnits: 42,
  lessonsPerUnit: 4,
  unit: { level: "B1" as const, titleEs: "¡Ojalá! Deseos y celebraciones", titlePt: "Tomara!", theme: "festas" },
  lessonsCompleted: 33,
  streakDays: 3,
  vocabulary: { total: 280, mastered: 120, due: 9 },
  reinforcing: false,
};

const fill: ExerciseView = {
  index: 0,
  type: "fill",
  skill: "conjugacion",
  focus: "presente de subjuntivo",
  instruction: "Complete com o verbo no presente do subjuntivo.",
  prompt: "Ojalá que ___ buen tiempo mañana.",
  options: null,
  hint: "hacer · él",
  source: null,
  task: null,
  requirements: null,
  minWords: null,
  maxWords: null,
  result: null,
};

function lessonWith(exercise: ExerciseView, questions: QuestionView[] = []): LessonView {
  return {
    id: "lesson-1",
    kind: "regular",
    unit: 9,
    step: 2,
    role: "Prática",
    title: "Deseos con ojalá",
    goal: "Expressar desejos com o subjuntivo.",
    cursor: 1,
    completed: false,
    score: null,
    steps: [
      { kind: "explanation", title: "Ojalá + subjuntivo", body: "**Ojalá** pede subjuntivo.", examples: [], questions: [] },
      { kind: "exercise", exercise, questions },
    ],
    review: null,
  };
}

function lessonState(exercise: ExerciseView, questions: QuestionView[] = []): CourseState {
  return { status: "lesson", error: null, course, lesson: lessonWith(exercise, questions), next: null };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

function signIn(role: "admin" | "user") {
  localStorage.setItem("dashboard_me", JSON.stringify({ role, id: "u1", name: "Pessoa" }));
}

async function openLesson() {
  fireEvent.click(screen.getByRole("button", { name: "Estudar espanhol enquanto a execução continua" }));
  return screen.findByRole("dialog", { name: "Aula de espanhol" });
}

it("só o admin vê a aula de espanhol, e só durante a execução", () => {
  signIn("user");
  const { rerender } = render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  expect(screen.queryByRole("button", { name: /Estudar espanhol/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Jogar Decanta/ })).toBeInTheDocument();

  signIn("admin");
  rerender(<GameLauncher executionId="exec-2" live awaitingInput={false} />);
  expect(screen.getByRole("button", { name: /Estudar espanhol/ })).toBeInTheDocument();
  rerender(<GameLauncher executionId="exec-2" live={false} awaitingInput={false} />);
  expect(screen.queryByRole("button", { name: /Estudar espanhol/ })).not.toBeInTheDocument();
});

it("começa o curso a partir das boas-vindas", async () => {
  signIn("admin");
  api.get.mockResolvedValue({ state: { status: "welcome", error: null, course: null, lesson: null, next: null }, availability: "playable" });
  api.post.mockResolvedValue({ state: { status: "preparing-course", error: null, course: null, lesson: null, next: null } });
  render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openLesson();
  expect(api.get).toHaveBeenCalledWith(`/spanish?execId=exec-1&timeZone=${encodeURIComponent(timeZone)}`);

  fireEvent.click(await screen.findByRole("button", { name: "Começar o curso" }));
  expect(api.post).toHaveBeenCalledWith("/spanish/start", { execId: "exec-1", timeZone });
  expect(await screen.findByText("Montando seu curso do A2+ ao B2")).toBeInTheDocument();
});

it("envia a lacuna, mostra a correção e oferece revisão da resposta", async () => {
  signIn("admin");
  api.get.mockResolvedValue({ state: lessonState(fill), availability: "playable" });
  render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openLesson();
  expect(await screen.findByText("Deseos con ojalá")).toBeInTheDocument();
  expect(screen.getByText("hacer · él")).toBeInTheDocument();

  const graded: ExerciseView = {
    ...fill,
    result: {
      answer: "hace", status: "graded", verdict: "incorrect", score: 0,
      expected: "haga", explanation: "Ojalá sempre pede subjuntivo.", correctOption: null, canAppeal: true,
    },
  };
  api.post.mockResolvedValueOnce({ state: lessonState(graded) });
  fireEvent.change(screen.getByRole("textbox", { name: "Resposta da lacuna" }), { target: { value: " hace " } });
  fireEvent.click(screen.getByRole("button", { name: "Verificar" }));

  expect(api.post).toHaveBeenCalledWith("/spanish/answer", { lessonId: "lesson-1", index: 0, answer: "hace", execId: "exec-1", timeZone });
  expect(await screen.findByText("Não foi dessa vez")).toBeInTheDocument();
  expect(screen.getByText("haga")).toBeInTheDocument();
  expect(screen.getByText("Ojalá sempre pede subjuntivo.")).toBeInTheDocument();

  api.post.mockResolvedValueOnce({ state: lessonState({ ...graded, result: { ...graded.result!, appeal: "pending", canAppeal: false } }) });
  fireEvent.click(screen.getByRole("button", { name: "Minha resposta também está certa?" }));
  expect(api.post).toHaveBeenLastCalledWith("/spanish/appeal", { lessonId: "lesson-1", index: 0, execId: "exec-1", timeZone });
  expect(await screen.findByText("Revisando sua resposta…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Concluir a aula" })).toBeDisabled();
});

it("esconde a aula enquanto a execução espera uma resposta e volta depois", async () => {
  signIn("admin");
  api.get.mockResolvedValue({ state: lessonState(fill), availability: "playable" });
  const { rerender } = render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openLesson();
  rerender(<GameLauncher executionId="exec-1" live awaitingInput />);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Aula de espanhol" })).not.toBeInTheDocument());
  rerender(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  expect(await screen.findByRole("dialog", { name: "Aula de espanhol" })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(2);
});

it("guarda o que foi digitado quando a execução termina e recupera no próximo prompt", async () => {
  signIn("admin");
  api.get.mockResolvedValue({ state: lessonState(fill), availability: "playable" });
  const { rerender } = render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openLesson();
  fireEvent.change(await screen.findByRole("textbox", { name: "Resposta da lacuna" }), { target: { value: "haga" } });

  rerender(<GameLauncher executionId="exec-1" live={false} awaitingInput={false} />);
  expect(screen.queryByRole("dialog", { name: "Aula de espanhol" })).not.toBeInTheDocument();

  rerender(<GameLauncher executionId="exec-2" live awaitingInput={false} />);
  await openLesson();
  expect(await screen.findByRole("textbox", { name: "Resposta da lacuna" })).toHaveValue("haga");

  const graded: ExerciseView = {
    ...fill,
    result: { answer: "haga", status: "graded", verdict: "correct", score: 1, expected: "haga", explanation: "", correctOption: null, canAppeal: false },
  };
  api.post.mockResolvedValueOnce({ state: lessonState(graded) });
  fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
  expect(await screen.findByText("Correto!")).toBeInTheDocument();
  expect(Object.keys(localStorage).filter((key) => key.startsWith("espanol:draft:"))).toEqual([]);
});

it("tira uma dúvida com o professor sem perder o texto e mostra a resposta", async () => {
  signIn("admin");
  api.get.mockResolvedValue({ state: lessonState(fill), availability: "playable" });
  render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openLesson();
  fireEvent.click(await screen.findByRole("button", { name: "Tirar uma dúvida com o professor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Sua dúvida" }), { target: { value: "Por que não é hace?" } });
  expect(localStorage.getItem("espanol:draft:lesson-1:question:1")).toBe("Por que não é hace?");

  api.post.mockResolvedValueOnce({ state: lessonState(fill, [{ question: "Por que não é hace?", status: "pending" }]) });
  fireEvent.click(screen.getByRole("button", { name: "Perguntar" }));
  expect(api.post).toHaveBeenCalledWith("/spanish/ask", { lessonId: "lesson-1", step: 1, question: "Por que não é hace?", execId: "exec-1", timeZone });
  expect(await screen.findByText("O professor está respondendo…")).toBeInTheDocument();
  expect(localStorage.getItem("espanol:draft:lesson-1:question:1")).toBeNull();

  api.get.mockResolvedValue({ state: lessonState(fill, [{ question: "Por que não é hace?", status: "answered", answer: "**Ojalá** pede subjuntivo." }]), availability: "playable" });
  expect(await screen.findByText("Ojalá", { selector: "strong" }, { timeout: 4000 })).toBeInTheDocument();
});

it("ao fim da aula mostra o comentário do professor e a recomendação de reforço", async () => {
  signIn("admin");
  const completed: CourseState = {
    status: "lesson",
    error: null,
    course,
    lesson: {
      ...lessonWith({ ...fill, result: { answer: "haga", status: "graded", verdict: "correct", score: 1, expected: "haga", explanation: "", correctOption: null, canAppeal: false } }),
      completed: true,
      score: 0.58,
      review: { status: "ready", comment: "Você acertou o subjuntivo com ojalá, mas ainda troca ser e estar.", reinforcement: { recommended: true, reason: "Ser e estar com estados ainda escapa." }, pace: "consolidar" },
    },
    next: { slot: { unit: 9, step: 3 }, ready: true, error: null },
  };
  api.get.mockResolvedValue({ state: completed, availability: "playable" });
  render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openLesson();
  expect(await screen.findByText("Você acertou o subjuntivo com ojalá, mas ainda troca ser e estar.")).toBeInTheDocument();
  expect(screen.getByText("Ser e estar com estados ainda escapa.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Seguir sem reforço" })).toBeInTheDocument();

  api.post.mockResolvedValueOnce({ state: { status: "preparing-lesson", error: null, course: { ...course, reinforcing: true }, lesson: null, next: null } });
  fireEvent.click(screen.getByRole("button", { name: "Fazer o reforço" }));
  expect(api.post).toHaveBeenCalledWith("/spanish/reinforce", { execId: "exec-1", timeZone });
  expect(await screen.findByText("Preparando sua aula de reforço")).toBeInTheDocument();
  expect(screen.getByText("Unidade 9 de 42 · aula de reforço")).toBeInTheDocument();
});

it("o painel do professor mostra o diagnóstico e salva os dados do aluno", async () => {
  signIn("admin");
  const overview: TeacherOverview = {
    profile: {
      weaknesses: [{
        id: "ser-estar-estado", title: "Ser e estar com estados", skill: "ser_estar", rule: "Estado passageiro usa estar.",
        interference: "Em português se diz \"é casado\".", examples: [{ wrong: "es cansado", right: "está cansado" }],
        priority: "alta", trend: "persistente", since: new Date().toISOString(),
      }],
      strengths: ["Presente regular"],
      resolved: [{ id: "muy-mucho", title: "Muy e mucho", resolvedAt: new Date().toISOString() }],
      pace: "consolidar",
      guidance: "",
      updatedAt: new Date().toISOString(),
      lessonsAnalyzed: 3,
    },
    reviews: [{ lessonId: "l0", title: "El trabajo", kind: "regular", unit: 9, step: 1, completedAt: new Date().toISOString(), review: { comment: "Boa aula, cuidado com estar.", reinforcement: { recommended: false, reason: "" }, pace: "consolidar", createdAt: new Date().toISOString() } }],
    categories: [{ category: "ser_estar", count: 4 }],
    student: { goal: "", examDate: null, interests: "", notes: "", variant: "peninsular" },
    examDaysLeft: null,
  };
  api.get.mockImplementation((path: string) => Promise.resolve(path.startsWith("/spanish/teacher") ? overview : { state: lessonState(fill), availability: "playable" }));
  render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openLesson();
  fireEvent.click(await screen.findByRole("button", { name: "Seu professor" }));

  expect(await screen.findByText("Ser e estar com estados")).toBeInTheDocument();
  expect(screen.getByText("Estado passageiro usa estar.")).toBeInTheDocument();
  expect(screen.getByText("es cansado")).toBeInTheDocument();
  expect(screen.getByText("Boa aula, cuidado com estar.")).toBeInTheDocument();
  expect(screen.getByText("Muy e mucho")).toBeInTheDocument();
  expect(screen.getByText("Ritmo: Consolidar")).toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "Interesses" }), { target: { value: "tecnologia" } });
  fireEvent.click(screen.getByRole("radio", { name: "América (ustedes)" }));
  expect(JSON.parse(localStorage.getItem("espanol:student-draft")!)).toMatchObject({ interests: "tecnologia", variant: "americana" });
  api.post.mockResolvedValueOnce({ state: lessonState(fill) });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(api.post).toHaveBeenCalledWith("/spanish/student", {
    student: { goal: "", examDate: null, interests: "tecnologia", notes: "", variant: "americana" },
    execId: "exec-1",
    timeZone,
  });
  expect(await screen.findByText(/Salvo\. O professor vai considerar/)).toBeInTheDocument();
  expect(localStorage.getItem("espanol:student-draft")).toBeNull();
});
