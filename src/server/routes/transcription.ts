import { Router, raw } from "express";
import { transcribeAudio } from "../../transcription.js";

export const transcriptionRouter = Router();

transcriptionRouter.post("/", raw({ type: "audio/*", limit: "10mb" }), async (req, res) => {
  if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "No audio data received" });
    return;
  }

  const contentType = req.headers["content-type"] || "audio/webm";
  const ext = contentType.includes("wav") ? "wav" : contentType.includes("mp4") ? "m4a" : "webm";

  try {
    const text = await transcribeAudio(req.body, `recording.${ext}`);
    res.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    res.status(500).json({ error: message });
  }
});
