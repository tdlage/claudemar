import { useState, useRef, useCallback } from "react";
import { Mic, Loader2 } from "lucide-react";
import { useToast } from "./Toast";

interface VoiceInputProps {
  onTranscription: (text: string) => void;
  disabled?: boolean;
}

export function VoiceInput({ onTranscription, disabled }: VoiceInputProps) {
  const { addToast } = useToast();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      addToast("error", "Microphone not available (HTTPS required)");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("[VoiceInput] getUserMedia error:", err);
      const errName = err instanceof DOMException ? err.name : "";
      if (errName === "NotAllowedError") {
        addToast("error", "Microphone blocked — check site permissions in browser");
      } else if (errName === "NotFoundError") {
        addToast("error", "No microphone found");
      } else {
        addToast("error", `Microphone error: ${errName || (err instanceof Error ? err.message : "unknown")}`);
      }
      return;
    }

    streamRef.current = stream;

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];

      if (blob.size === 0) return;

      setTranscribing(true);
      try {
        const token = localStorage.getItem("dashboard_token") || "";
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": mimeType.split(";")[0],
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: blob,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || res.statusText);
        }

        const { text } = await res.json();
        if (text) onTranscription(text);
      } catch (err) {
        addToast("error", err instanceof Error ? err.message : "Transcription failed");
      } finally {
        setTranscribing(false);
      }
    };

    recorder.start();
    setRecording(true);
  }, [onTranscription, addToast]);

  const handleClick = () => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  if (transcribing) {
    return (
      <button
        type="button"
        disabled
        className="flex items-center justify-center w-8 h-8 rounded-md text-accent"
        title="Transcribing..."
      >
        <Loader2 size={16} className="animate-spin" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || transcribing}
      title={recording ? "Stop recording" : "Voice input"}
      className={`flex items-center justify-center w-8 h-8 rounded-md transition-all ${
        recording
          ? "bg-red-500/20 text-red-400 animate-pulse"
          : "text-text-muted hover:text-text-secondary hover:bg-surface-hover"
      }`}
    >
      <Mic size={16} />
    </button>
  );
}
