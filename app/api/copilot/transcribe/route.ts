// app/api/copilot/transcribe/route.ts
//
// Sprint 16a Bloque 3 — transcribe via OpenAI Whisper.
//
// POST multipart/form-data con campo `audio` (Blob webm/mp4, max ~25MB).
// Devuelve { text } o { error }.
//
// Auth: misma sesión Fyllio (withAuth). El audio nunca toca disco; se
// reenvía a OpenAI directamente como FormData.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB, límite Whisper API.

export const POST = withAuth(async (_session, req) => {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY no configurada en el entorno." },
      { status: 500 },
    );
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "Falta campo audio" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Audio demasiado grande (${Math.round(audio.size / 1024)} KB > 25 MB).` },
      { status: 413 },
    );
  }

  // Reenvío directo a OpenAI Whisper.
  const upstreamForm = new FormData();
  // Inferimos extensión del MIME, default webm.
  const mime = audio.type || "audio/webm";
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
  upstreamForm.append("file", audio, `audio.${ext}`);
  upstreamForm.append("model", "whisper-1");
  upstreamForm.append("language", "es");
  upstreamForm.append("response_format", "json");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamForm,
    });
    if (!res.ok) {
      const errTxt = await res.text();
      console.error("[copilot/transcribe] openai", res.status, errTxt.slice(0, 300));
      return NextResponse.json(
        { error: `Whisper devolvió ${res.status}.` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ text: (data.text ?? "").trim() });
  } catch (err) {
    console.error("[copilot/transcribe] network", err);
    return NextResponse.json(
      { error: "Error de red llamando a Whisper." },
      { status: 502 },
    );
  }
});
