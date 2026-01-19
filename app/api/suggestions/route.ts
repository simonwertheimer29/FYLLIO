import { NextResponse } from "next/server";

export async function GET() {
  // Datos de ejemplo de un día de agenda
  const data = {
    date: "2025-12-11",
    appointments: [
      {
        id: 1,
        patientName: "María López",
        start: "2025-12-11T09:00:00",
        end: "2025-12-11T09:30:00",
        type: "Limpieza",
      },
      {
        id: 2,
        patientName: "Juan Pérez",
        start: "2025-12-11T10:30:00",
        end: "2025-12-11T11:00:00",
        type: "Revisión",
      },
      {
        id: 3,
        patientName: "Ana García",
        start: "2025-12-11T11:30:00",
        end: "2025-12-11T12:30:00",
        type: "Endodoncia",
      },
    ],
    // Textos bilingües
    suggestions: [
      {
        id: 1,
        messageEs:
          "Hay un hueco de 60 minutos entre María López y Juan Pérez.",
        messageEn:
          "There is a 60-minute gap between María López and Juan Pérez.",
      },
      {
        id: 2,
        messageEs:
          "Hay un hueco de 30 minutos entre Juan Pérez y Ana García.",
        messageEn:
          "There is a 30-minute gap between Juan Pérez and Ana García.",
      },
      {
        id: 3,
        messageEs:
          "Día con varias citas seguidas. Quizá Fyllio podría bloquear un descanso corto al mediodía.",
        messageEn:
          "Day with several back-to-back appointments. Fyllio might suggest a short break around midday.",
      },
    ],
  };

  return NextResponse.json(data);
}
