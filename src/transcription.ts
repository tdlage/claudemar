import OpenAI, { toFile } from "openai";
import { config } from "./config.js";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
): Promise<string> {
  const file = await toFile(audioBuffer, filename);

  const transcription = await getClient().audio.transcriptions.create({
    model: "whisper-1",
    file,
  });

  return transcription.text;
}
