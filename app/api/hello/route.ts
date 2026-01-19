import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    message: "Hello Simón, Fyllio is alive 🧠🚀",
    timestamp: new Date().toISOString(),
  });
}
