// app/api/dashboard/feedback/route.ts
// Feedback & reputation stats: aggregate scores stored in KV as fb:{phone}:{ts}
// Negative alerts stored as fb:alert:{phone}:{ts}

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

type FeedbackEntry = {
  score: number;
  name: string;
  apptId: string;
};

type AlertEntry = {
  score: number;
  name: string;
  apptId: string;
};

export async function GET() {
  try {
    const [scoreKeys, alertKeys] = await Promise.all([
      kv.keys("fb:*").then((keys) => keys.filter((k) => !k.includes(":alert:"))),
      kv.keys("fb:alert:*"),
    ]);

    // Fetch all scores in parallel (cap at 200 to avoid overwhelming)
    const scoreEntries = await Promise.all(
      scoreKeys.slice(0, 200).map((k) => kv.get<FeedbackEntry>(k))
    );
    const validScores = scoreEntries.filter((e): e is FeedbackEntry => e !== null && typeof e.score === "number");

    // Aggregate
    const count = validScores.length;
    const avg = count > 0
      ? Math.round((validScores.reduce((s, e) => s + e.score, 0) / count) * 10) / 10
      : null;

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const e of validScores) {
      if (e.score >= 1 && e.score <= 5) distribution[e.score]++;
    }

    const googleReviewsSent = validScores.filter((e) => e.score >= 4).length;

    // Negative alerts
    const alertEntries = await Promise.all(
      alertKeys.slice(0, 50).map((k) => kv.get<AlertEntry>(k))
    );
    const alerts = alertEntries
      .filter((e): e is AlertEntry => e !== null)
      .map((e) => ({ score: e.score, name: e.name }));

    return NextResponse.json({
      count,
      avg,
      distribution,
      googleReviewsSent,
      negativeAlerts: alerts,
      negativeCount: alerts.length,
    });
  } catch (e: any) {
    console.error("[feedback stats] error", e);
    return NextResponse.json({
      count: 0,
      avg: null,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      googleReviewsSent: 0,
      negativeAlerts: [],
      negativeCount: 0,
    });
  }
}
