import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getAgentPaths } from "../agents/manager.js";
import { driveStore, type DriveAccount, type DriveFolderLink } from "./store.js";
import { accountCanWrite, authorizedClient, isReauthError } from "./oauth.js";
import { driveErrorInfo } from "./drive-api.js";
import { localFileName, readManifest } from "./mirror.js";
import { driveInputRoot, manifestPath } from "./paths.js";
import { driveSync, REAUTH_MESSAGE } from "./sync.js";
import { DOC_MIME, SHEET_MIME, SLIDES_MIME, flattenDocTabs, formatDocBody, formatPresentation, formatSheetValues } from "./native-format.js";

const API_TIMEOUT_MS = 60_000;
const MAX_READ_CHARS = 30_000;
const MAX_SHEET_CELLS = 5_000;

type Kind = "doc" | "sheet" | "slides";

const KIND_MIME: Record<Kind, string> = { doc: DOC_MIME, sheet: SHEET_MIME, slides: SLIDES_MIME };
const KIND_LABEL: Record<Kind, string> = { doc: "Google Docs", sheet: "Google Sheets", slides: "Google Slides" };

interface ResolvedFile {
  link: DriveFolderLink;
  account: DriveAccount;
  fileId: string;
  shortcut: boolean;
}

class ToolError extends Error {}

const createdFiles = new Map<string, { linkId: string; mimeType: string }>();

const fileRef = {
  path: z.string().optional().describe("Path of the converted copy in the mirrored Google Drive folder (e.g. input/google-drive/Reports/Plan.md), absolute or relative to your working directory"),
  file_id: z.string().optional().describe("Google Drive file id, for files created with create_google_file that are not mirrored yet"),
};

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const apiRequests = z.array(z.record(z.string(), z.unknown())).min(1).describe("Requests in the official API format, applied atomically in order");

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function mirrorRoot(agentName: string): string {
  const root = driveInputRoot(agentName);
  if (!root) throw new ToolError("This agent has no Google Drive folders.");
  return root;
}

function locate(agentName: string, path: string): { link: DriveFolderLink; relativePath: string } {
  const paths = getAgentPaths(agentName);
  const root = mirrorRoot(agentName);
  const candidates = isAbsolute(path) ? [resolve(path)] : [resolve(paths!.root, path), resolve(root, path)];
  for (const candidate of candidates) {
    const inside = relative(root, candidate);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) continue;
    const [localName, ...rest] = inside.split(sep);
    const link = driveStore.foldersOf(agentName).find((folder) => folder.localName === localName);
    if (link) return { link, relativePath: rest.join("/") };
  }
  throw new ToolError(`"${path}" is not inside a Google Drive folder shared with this agent.`);
}

function accountOf(link: DriveFolderLink): DriveAccount {
  const account = driveStore.getAccount(link.accountId);
  if (!account || account.reauthRequired) throw new ToolError(REAUTH_MESSAGE);
  return account;
}

async function resolveFile(agentName: string, ref: { path?: string; file_id?: string }, kind: Kind): Promise<ResolvedFile> {
  const mimeType = KIND_MIME[kind];
  if (ref.file_id) {
    const created = createdFiles.get(ref.file_id);
    const createdLink = created && driveStore.getFolder(created.linkId);
    if (createdLink && createdLink.agentName === agentName) {
      if (created.mimeType !== mimeType) throw new ToolError(`File ${ref.file_id} is not a ${KIND_LABEL[kind]} file.`);
      return { link: createdLink, account: accountOf(createdLink), fileId: ref.file_id, shortcut: false };
    }
    for (const link of driveStore.foldersOf(agentName)) {
      const entry = (await readManifest(manifestPath(link.id))).files.find((file) => file.id === ref.file_id || file.sourceId === ref.file_id);
      if (!entry) continue;
      if (entry.mimeType !== mimeType) throw new ToolError(`File ${ref.file_id} is not a ${KIND_LABEL[kind]} file.`);
      return { link, account: accountOf(link), fileId: entry.sourceId ?? entry.id, shortcut: (entry.sourceId ?? entry.id) !== entry.id };
    }
    throw new ToolError(`File ${ref.file_id} is not in a Google Drive folder shared with this agent.`);
  }
  if (!ref.path) throw new ToolError("Provide path or file_id.");
  const { link, relativePath } = locate(agentName, ref.path);
  const entry = (await readManifest(manifestPath(link.id))).files.find((file) => file.path === relativePath);
  if (!entry) throw new ToolError(`"${ref.path}" is not a synced file of "${link.folderName}". Sync the folder or check the path.`);
  if (entry.mimeType !== mimeType) {
    throw new ToolError(`"${ref.path}" is not a ${KIND_LABEL[kind]} file.${entry.exportMimeType ? "" : " Regular files are edited directly in the folder."}`);
  }
  return { link, account: accountOf(link), fileId: entry.sourceId ?? entry.id, shortcut: (entry.sourceId ?? entry.id) !== entry.id };
}

function requireWrite(file: ResolvedFile): void {
  if (file.link.access !== "write") {
    throw new ToolError(`"${file.link.folderName}" is shared with this agent as read-only. Ask the person who shared it to give write permission in the dashboard.`);
  }
  if (!accountCanWrite(file.account)) throw new ToolError(`Write access to Google Drive was not granted for "${file.link.folderName}".`);
  if (file.shortcut) throw new ToolError("This file is a shortcut to a file stored outside the shared folder, so it can only be read.");
}

function refreshMirror(link: DriveFolderLink): void {
  driveSync.resync(link.id);
}

interface CallContext {
  account: DriveAccount | null;
}

async function run<T>(task: (context: CallContext) => Promise<T>, render: (result: T) => string) {
  const context: CallContext = { account: null };
  try {
    return text(render(await task(context)));
  } catch (err) {
    if (err instanceof ToolError) return failure(err.message);
    if (context.account && isReauthError(err)) {
      await driveStore.markReauthRequired(context.account.id);
      return failure(REAUTH_MESSAGE);
    }
    return failure(`Google API error: ${driveErrorInfo(err).message}`);
  }
}

function clients(auth: OAuth2Client) {
  return {
    docs: google.docs({ version: "v1", auth }),
    sheets: google.sheets({ version: "v4", auth }),
    slides: google.slides({ version: "v1", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

function api(file: ResolvedFile) {
  return clients(authorizedClient(file.account));
}

const options = { timeout: API_TIMEOUT_MS };

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function hasGoogleFileTools(agentName: string): boolean {
  return driveStore.foldersOf(agentName).length > 0;
}

export function createGoogleFilesMcpServer(agentName: string): ReturnType<typeof createSdkMcpServer> {
  const docsRead = tool(
    "docs_read",
    "Reads a Google Doc from a shared Google Drive folder with the start/end index of every paragraph and table cell (indexes are UTF-16 code units), so you can edit it precisely with docs_batch_update. Lists the document tabs; reads the first tab unless tab_id is given.",
    {
      ...fileRef,
      tab_id: z.string().optional().describe("Tab to read (ids are listed in the output)"),
      from_index: z.number().int().min(0).optional().describe("Skip content before this index (to continue a truncated read)"),
    },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "doc");
        context.account = file.account;
        const { data } = await api(file).docs.documents.get({ documentId: file.fileId, includeTabsContent: true }, options);
        const tabs = flattenDocTabs(data.tabs ?? undefined);
        const tab = args.tab_id ? tabs.find((entry) => entry.id === args.tab_id) : tabs[0];
        if (!tab) throw new ToolError(`Tab ${args.tab_id} not found.`);
        const body = formatDocBody(tab.body, args.from_index ?? 0, MAX_READ_CHARS);
        const tabList = tabs.map((entry) => `${"  ".repeat(entry.depth)}- ${entry.id}: ${entry.title}`).join("\n");
        return `Document "${data.title ?? ""}" (id ${file.fileId}, revision ${data.revisionId ?? "?"})\nTabs:\n${tabList}\nTab ${tab.id} "${tab.title}":\n${body.text}`;
      }, (result) => result);
    },
  );

  const docsReplaceText = tool(
    "docs_replace_text",
    "Replaces every occurrence of a text in a Google Doc, keeping the formatting around it. Only for folders shared with write permission.",
    {
      ...fileRef,
      find: z.string().min(1).describe("Exact text to find"),
      replace: z.string().describe("Replacement text"),
      match_case: z.boolean().optional().describe("Case-sensitive match (default true)"),
      tab_ids: z.array(z.string()).optional().describe("Limit to these tabs"),
    },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "doc");
        context.account = file.account;
        requireWrite(file);
        const { data } = await api(file).docs.documents.batchUpdate({
          documentId: file.fileId,
          requestBody: {
            requests: [{
              replaceAllText: {
                containsText: { text: args.find, matchCase: args.match_case ?? true },
                replaceText: args.replace,
                ...(args.tab_ids?.length ? { tabsCriteria: { tabIds: args.tab_ids } } : {}),
              },
            }],
          },
        }, options);
        refreshMirror(file.link);
        return data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
      }, (count) => `Replaced ${count} occurrence(s).`);
    },
  );

  const docsBatchUpdate = tool(
    "docs_batch_update",
    "Applies Google Docs API batchUpdate requests (insertText, deleteContentRange, updateTextStyle, updateParagraphStyle, createParagraphBullets, insertTable, insertInlineImage, …) to a Google Doc. Read it first with docs_read to get indexes; when editing several places, apply requests from the highest index to the lowest. Include tabId in locations for tabs other than the first. Only for folders shared with write permission.",
    { ...fileRef, requests: apiRequests, required_revision_id: z.string().optional().describe("Fail instead of applying if the document changed since this revision") },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "doc");
        context.account = file.account;
        requireWrite(file);
        const { data } = await api(file).docs.documents.batchUpdate({
          documentId: file.fileId,
          requestBody: { requests: args.requests, ...(args.required_revision_id ? { writeControl: { requiredRevisionId: args.required_revision_id } } : {}) },
        }, options);
        refreshMirror(file.link);
        return data;
      }, (data) => `Applied ${args.requests.length} request(s). New revision ${data.writeControl?.requiredRevisionId ?? "?"}.${data.replies?.some((reply) => Object.keys(reply).length > 0) ? `\nReplies: ${JSON.stringify(data.replies)}` : ""}`);
    },
  );

  const sheetsRead = tool(
    "sheets_read",
    "Reads a Google Sheets spreadsheet from a shared Google Drive folder. Without range it lists every sheet (tab) with its size and shows the first rows of the first sheet. With range (A1 notation, e.g. 'Budget!A1:F40') it returns the cells with their A1 addresses.",
    {
      ...fileRef,
      range: z.string().optional().describe("A1 range, e.g. 'Sheet1!A1:D50'"),
      formulas: z.boolean().optional().describe("Return formulas instead of displayed values"),
    },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "sheet");
        context.account = file.account;
        const { sheets } = api(file);
        const { data: meta } = await sheets.spreadsheets.get({
          spreadsheetId: file.fileId,
          fields: "properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))",
        }, options);
        const tabs = (meta.sheets ?? []).map((sheet) => sheet.properties!);
        const range = args.range ?? (tabs[0] ? `${quoteSheetTitle(tabs[0].title ?? "")}!A1:Z50` : "A1:Z50");
        const { data } = await sheets.spreadsheets.values.get({
          spreadsheetId: file.fileId,
          range,
          valueRenderOption: args.formulas ? "FORMULA" : "FORMATTED_VALUE",
        }, options);
        const listing = tabs.map((tab) => `- ${tab.title} (sheetId ${tab.sheetId}, ${tab.gridProperties?.rowCount ?? 0} rows x ${tab.gridProperties?.columnCount ?? 0} columns)`).join("\n");
        const values = formatSheetValues(data.range ?? range, (data.values ?? []) as unknown[][], MAX_SHEET_CELLS);
        return `Spreadsheet "${meta.properties?.title ?? ""}" (id ${file.fileId})\nSheets:\n${listing}\n${values.text}`;
      }, (result) => result);
    },
  );

  const sheetsWrite = tool(
    "sheets_write",
    "Writes values into a range of a Google Sheets spreadsheet. Values are interpreted like typed by a user (formulas starting with = are evaluated, numbers and dates parsed) unless raw is true. Only for folders shared with write permission.",
    {
      ...fileRef,
      range: z.string().describe("A1 range where the top-left value goes, e.g. 'Budget!B2'"),
      values: z.array(z.array(cellValue)).min(1).describe("Rows of cell values"),
      raw: z.boolean().optional().describe("Store values exactly as given, without parsing"),
    },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "sheet");
        context.account = file.account;
        requireWrite(file);
        const { data } = await api(file).sheets.spreadsheets.values.update({
          spreadsheetId: file.fileId,
          range: args.range,
          valueInputOption: args.raw ? "RAW" : "USER_ENTERED",
          requestBody: { values: args.values },
        }, options);
        refreshMirror(file.link);
        return data;
      }, (data) => `Updated ${data.updatedCells ?? 0} cell(s) in ${data.updatedRange ?? args.range}.`);
    },
  );

  const sheetsAppend = tool(
    "sheets_append",
    "Appends rows after the last row with data of a table in a Google Sheets spreadsheet. Only for folders shared with write permission.",
    {
      ...fileRef,
      range: z.string().describe("Sheet or table range to append to, e.g. 'Leads!A:F'"),
      values: z.array(z.array(cellValue)).min(1).describe("Rows to append"),
      raw: z.boolean().optional().describe("Store values exactly as given, without parsing"),
    },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "sheet");
        context.account = file.account;
        requireWrite(file);
        const { data } = await api(file).sheets.spreadsheets.values.append({
          spreadsheetId: file.fileId,
          range: args.range,
          valueInputOption: args.raw ? "RAW" : "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: args.values },
        }, options);
        refreshMirror(file.link);
        return data;
      }, (data) => `Appended ${data.updates?.updatedRows ?? 0} row(s) at ${data.updates?.updatedRange ?? args.range}.`);
    },
  );

  const sheetsClear = tool(
    "sheets_clear",
    "Clears the values (keeping formatting) of a range in a Google Sheets spreadsheet. Only for folders shared with write permission.",
    { ...fileRef, range: z.string().describe("A1 range to clear") },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "sheet");
        context.account = file.account;
        requireWrite(file);
        const { data } = await api(file).sheets.spreadsheets.values.clear({ spreadsheetId: file.fileId, range: args.range, requestBody: {} }, options);
        refreshMirror(file.link);
        return data;
      }, (data) => `Cleared ${data.clearedRange ?? args.range}.`);
    },
  );

  const sheetsBatchUpdate = tool(
    "sheets_batch_update",
    "Applies Google Sheets API spreadsheets.batchUpdate requests (addSheet, deleteSheet, duplicateSheet, insertDimension, deleteDimension, repeatCell, updateBorders, mergeCells, addConditionalFormatRule, sortRange, …) for structure and formatting changes. Use sheets_write for values. Only for folders shared with write permission.",
    { ...fileRef, requests: apiRequests },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "sheet");
        context.account = file.account;
        requireWrite(file);
        const { data } = await api(file).sheets.spreadsheets.batchUpdate({ spreadsheetId: file.fileId, requestBody: { requests: args.requests } }, options);
        refreshMirror(file.link);
        return data;
      }, (data) => `Applied ${args.requests.length} request(s).${data.replies?.some((reply) => Object.keys(reply).length > 0) ? `\nReplies: ${JSON.stringify(data.replies)}` : ""}`);
    },
  );

  const slidesRead = tool(
    "slides_read",
    "Reads a Google Slides presentation from a shared Google Drive folder: every slide with its objectId and its elements (objectId, type, placeholder, size and position in points, text, table cells) plus speaker notes, so you can edit it with slides_batch_update.",
    { ...fileRef, slide_numbers: z.array(z.number().int().min(1)).optional().describe("Only these slides (1-based)") },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "slides");
        context.account = file.account;
        const { data } = await api(file).slides.presentations.get({ presentationId: file.fileId }, options);
        return `${formatPresentation(data, args.slide_numbers?.length ? args.slide_numbers : null, MAX_READ_CHARS).text}\n(presentation id ${file.fileId})`;
      }, (result) => result);
    },
  );

  const slidesReplaceText = tool(
    "slides_replace_text",
    "Replaces every occurrence of a text in a Google Slides presentation (optionally only on some slides), keeping the formatting. Only for folders shared with write permission.",
    {
      ...fileRef,
      find: z.string().min(1).describe("Exact text to find"),
      replace: z.string().describe("Replacement text"),
      match_case: z.boolean().optional().describe("Case-sensitive match (default true)"),
      slide_object_ids: z.array(z.string()).optional().describe("Limit to these slides (objectIds from slides_read)"),
    },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "slides");
        context.account = file.account;
        requireWrite(file);
        const { data } = await api(file).slides.presentations.batchUpdate({
          presentationId: file.fileId,
          requestBody: {
            requests: [{
              replaceAllText: {
                containsText: { text: args.find, matchCase: args.match_case ?? true },
                replaceText: args.replace,
                ...(args.slide_object_ids?.length ? { pageObjectIds: args.slide_object_ids } : {}),
              },
            }],
          },
        }, options);
        refreshMirror(file.link);
        return data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
      }, (count) => `Replaced ${count} occurrence(s).`);
    },
  );

  const slidesBatchUpdate = tool(
    "slides_batch_update",
    "Applies Google Slides API batchUpdate requests (createSlide, duplicateObject, deleteObject, updateSlidesPosition, insertText, deleteText, updateTextStyle, createShape, createImage, createTable, insertTableRows, updatePageElementTransform, …) to a presentation. Get objectIds with slides_read. Only for folders shared with write permission.",
    { ...fileRef, requests: apiRequests, required_revision_id: z.string().optional().describe("Fail instead of applying if the presentation changed since this revision") },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "slides");
        context.account = file.account;
        requireWrite(file);
        const { data } = await api(file).slides.presentations.batchUpdate({
          presentationId: file.fileId,
          requestBody: { requests: args.requests, ...(args.required_revision_id ? { writeControl: { requiredRevisionId: args.required_revision_id } } : {}) },
        }, options);
        refreshMirror(file.link);
        return data;
      }, (data) => `Applied ${args.requests.length} request(s). New revision ${data.writeControl?.requiredRevisionId ?? "?"}.${data.replies?.some((reply) => Object.keys(reply).length > 0) ? `\nReplies: ${JSON.stringify(data.replies)}` : ""}`);
    },
  );

  const slidesThumbnail = tool(
    "slides_thumbnail",
    "Renders one slide of a Google Slides presentation as a PNG image saved in your output folder, so you can look at it (for example to check an edit).",
    { ...fileRef, slide_object_id: z.string().describe("objectId of the slide (from slides_read)") },
    async (args) => {
      return run(async (context) => {
        const file = await resolveFile(agentName, args, "slides");
        context.account = file.account;
        const { data } = await api(file).slides.presentations.pages.getThumbnail({
          presentationId: file.fileId,
          pageObjectId: args.slide_object_id,
          "thumbnailProperties.mimeType": "PNG",
          "thumbnailProperties.thumbnailSize": "LARGE",
        }, options);
        if (!data.contentUrl) throw new ToolError("Google did not return the slide image.");
        const response = await fetch(data.contentUrl, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
        if (!response.ok) throw new ToolError(`Could not download the slide image (${response.status}).`);
        const directory = resolve(getAgentPaths(agentName)!.output, "google-drive-previews");
        await mkdir(directory, { recursive: true });
        const target = resolve(directory, localFileName(`${file.fileId}-${args.slide_object_id}`, ".png"));
        await writeFile(target, Buffer.from(await response.arrayBuffer()));
        return target;
      }, (target) => `Slide image saved to ${target}`);
    },
  );

  const createGoogleFile = tool(
    "create_google_file",
    "Creates a new Google Doc (optionally from Markdown), Google Sheets spreadsheet (optionally from CSV) or empty Google Slides presentation inside a shared Google Drive folder with write permission. Returns the file id to use with the other tools; its converted copy appears in the mirrored folder after the next sync.",
    {
      folder_path: z.string().describe("Folder in the mirrored Google Drive folder where the file is created (e.g. input/google-drive/Reports or a subfolder)"),
      name: z.string().min(1).describe("File name without extension"),
      kind: z.enum(["doc", "sheet", "slides"]),
      markdown: z.string().optional().describe("Initial content of a Google Doc, in Markdown"),
      csv: z.string().optional().describe("Initial content of a spreadsheet, as CSV"),
    },
    async (args) => {
      return run(async (context) => {
        const { link, relativePath } = locate(agentName, args.folder_path);
        const owner = accountOf(link);
        context.account = owner;
        requireWrite({ link, account: owner, fileId: link.folderId, shortcut: false });
        const folderId = relativePath
          ? (await readManifest(manifestPath(link.id))).folders?.find((folder) => folder.path === relativePath)?.id
          : link.folderId;
        if (!folderId) throw new ToolError(`"${args.folder_path}" is not a synced folder of "${link.folderName}".`);
        const mimeType = KIND_MIME[args.kind];
        const media = args.kind === "doc" && args.markdown
          ? { mimeType: "text/markdown", body: args.markdown }
          : args.kind === "sheet" && args.csv ? { mimeType: "text/csv", body: args.csv } : undefined;
        const { data } = await clients(authorizedClient(owner)).drive.files.create({
          requestBody: { name: args.name, mimeType, parents: [folderId] },
          ...(media ? { media } : {}),
          fields: "id,name,webViewLink",
          supportsAllDrives: true,
        }, options);
        if (!data.id) throw new ToolError("Google Drive did not return the new file id.");
        createdFiles.set(data.id, { linkId: link.id, mimeType });
        refreshMirror(link);
        return data;
      }, (data) => `Created ${KIND_LABEL[args.kind]} "${data.name}" (file_id ${data.id}): ${data.webViewLink ?? ""}`);
    },
  );

  return createSdkMcpServer({
    name: "gdrive",
    version: "1.0.0",
    tools: [
      docsRead, docsReplaceText, docsBatchUpdate,
      sheetsRead, sheetsWrite, sheetsAppend, sheetsClear, sheetsBatchUpdate,
      slidesRead, slidesReplaceText, slidesBatchUpdate, slidesThumbnail,
      createGoogleFile,
    ],
  });
}
