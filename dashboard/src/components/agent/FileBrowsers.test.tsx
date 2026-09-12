import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InputBrowser } from "./InputBrowser";
import { OutputBrowser } from "./OutputBrowser";
import { FilePreviewModal } from "../shared/FilePreviewModal";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("../shared/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
const fetchMock = vi.fn();
const file = { name: "notes.MD", size: 100, mtime: "2026-09-10T12:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("dashboard_token", "test-token");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it.each(["/projects/app", "/agents/worker"])("previews formatted Markdown beside Download in Input for %s", async (apiBasePath) => {
  fetchMock.mockResolvedValue(new Response("# Report\n\n**Important**\n\n- item"));
  render(<InputBrowser apiBasePath={apiBasePath} files={[file]} onRefresh={() => {}} />);
  expect(screen.getByTitle("Download")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preview notes.MD" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Report" })).toBeInTheDocument());
  expect(screen.getByText("Important").tagName).toBe("STRONG");
  expect(fetchMock).toHaveBeenCalledWith(`/api${apiBasePath}/input/notes.MD/download`, expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("previews files inside Output subdirectories with encoded paths", async () => {
  vi.mocked(api.get).mockResolvedValue([{ ...file, name: "result #1.txt", type: "file" }]);
  fetchMock.mockResolvedValue(new Response("line one\n  line two"));
  render(<OutputBrowser apiBasePath="/projects/app" files={[{ ...file, name: "reports", type: "directory" }]} onRefresh={() => {}} />);
  expect(screen.queryByTitle("Preview")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "reports" }));
  fireEvent.click(await screen.findByRole("button", { name: "Preview result #1.txt" }));
  await waitFor(() => expect(document.querySelector("pre")?.textContent).toBe("line one\n  line two"));
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/app/output-dl/reports/result%20%231.txt", expect.anything());
});

it("displays text as text without executing HTML", async () => {
  fetchMock.mockResolvedValue(new Response('<script>alert(1)</script>\n**literal**'));
  const { container } = render(<FilePreviewModal fileName="example.html" size={100} url="/api/example" onClose={() => {}} />);
  await waitFor(() => expect(container.querySelector("pre")?.textContent).toContain("<script>alert(1)</script>"));
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("strong")).toBeNull();
});

it("handles empty files and binary formats", async () => {
  fetchMock.mockResolvedValueOnce(new Response(""));
  const { rerender } = render(<FilePreviewModal fileName="empty.txt" size={0} url="/api/empty" onClose={() => {}} />);
  expect(await screen.findByText("Empty file.")).toBeInTheDocument();
  fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0, 255, 0])));
  rerender(<FilePreviewModal fileName="archive.bin" size={3} url="/api/binary" onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Preview unavailable");
});

it("does not load oversized text previews", async () => {
  render(<FilePreviewModal fileName="large.log" size={3 * 1024 * 1024} url="/api/large" onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Preview limited to 2MB");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reports HTTP errors", async () => {
  fetchMock.mockResolvedValue(new Response("", { status: 404 }));
  render(<FilePreviewModal fileName="missing.txt" size={10} url="/api/missing" onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("File not found");
});

it("ignores stale responses when a different file opens", async () => {
  let resolveFirst!: (value: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveFirst = resolve; }));
  const { rerender } = render(<FilePreviewModal fileName="first.txt" size={10} url="/api/first" onClose={() => {}} />);
  fetchMock.mockResolvedValueOnce(new Response("second content"));
  rerender(<FilePreviewModal fileName="second.txt" size={10} url="/api/second" onClose={() => {}} />);
  expect(await screen.findByText("second content")).toBeInTheDocument();
  await act(async () => { resolveFirst(new Response("first content")); });
  expect(screen.queryByText("first content")).not.toBeInTheDocument();
  expect(screen.getByText("second content")).toBeInTheDocument();
});
