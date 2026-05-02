// app/lib/copilot/tools-spec.ts
//
// Sprint 11 E — definiciones JSON-Schema de las tools que pasamos a la
// Messages API de Anthropic. Hay dos categorías:
//
//  - READ_TOOLS  → el backend las ejecuta y devuelve el resultado al
//                  modelo en otro turno del loop tool-use.
//  - ACTION_TOOLS → el backend NO las ejecuta. Las captura y las devuelve
//                  al frontend como sugerencias confirmables.
//
// Para Anthropic ambas son "tools" iguales — la diferencia es solo cómo
// las trata el endpoint /api/copilot/chat (ver tools-exec.ts).

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

// ═══ READ TOOLS ═══════════════════════════════════════════════════════

export const READ_TOOL_NAMES = [
  "count_leads_by_estado",
  "list_leads",
  "count_presupuestos_by_estado",
  "list_presupuestos",
  "pacientes_pendientes_pago",
  "kpis_resumen_clinica",
  "ranking_doctores",
  "mensajes_recientes",
  // Sprint 14b Bloque 8 — modulo financiero.
  "get_pagos_pendientes_clinica",
  "get_cobros_vencidos",
  "get_facturado_periodo",
  "get_top_pacientes_facturado",
] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];

export const READ_TOOLS: AnthropicTool[] = [
  {
    name: "count_leads_by_estado",
    description:
      "Cuenta leads del usuario actual filtrando por estado y/o por si tienen Fecha_Cita=hoy. " +
      "Ejemplos: cuántos leads sin gestionar (estado=Nuevo, llamado=false), cuántos citados hoy.",
    input_schema: {
      type: "object",
      properties: {
        estado: {
          type: "string",
          enum: ["Nuevo", "Contactado", "Citado", "Citados Hoy", "No Interesado", "Convertido"],
          description: "Filtra por este estado. Omitir para contar todos.",
        },
        sinContactar: {
          type: "boolean",
          description:
            "Si true, exige llamado=false AND whatsappEnviados=0. Útil para 'leads sin gestionar'.",
        },
        fechaCitaHoy: {
          type: "boolean",
          description:
            "Si true, exige Fecha_Cita igual a la fecha de hoy en zona Madrid.",
        },
      },
    },
  },
  {
    name: "list_leads",
    description:
      "Lista leads del usuario (limitado a sus clínicas accesibles). Devuelve nombre, " +
      "estado, tratamiento, canal, teléfono, días desde captación. Limit por defecto 10.",
    input_schema: {
      type: "object",
      properties: {
        estado: {
          type: "string",
          enum: ["Nuevo", "Contactado", "Citado", "Citados Hoy", "No Interesado", "Convertido"],
        },
        sinContactar: { type: "boolean" },
        fechaCitaHoy: { type: "boolean" },
        limit: { type: "number", description: "Máximo de leads a devolver (1-20)." },
      },
    },
  },
  {
    name: "count_presupuestos_by_estado",
    description:
      "Cuenta presupuestos por estado. Ejemplos de estado: PRESENTADO, INTERESADO, EN_DUDA, " +
      "EN_NEGOCIACION, ACEPTADO, PERDIDO.",
    input_schema: {
      type: "object",
      properties: {
        estado: {
          type: "string",
          enum: [
            "PRESENTADO",
            "INTERESADO",
            "EN_DUDA",
            "EN_NEGOCIACION",
            "ACEPTADO",
            "PERDIDO",
          ],
        },
      },
    },
  },
  {
    name: "list_presupuestos",
    description:
      "Lista presupuestos por estado. Devuelve paciente, importe, doctor, días desde " +
      "presupuesto, intención IA detectada y urgencia. Limit por defecto 10.",
    input_schema: {
      type: "object",
      properties: {
        estado: {
          type: "string",
          enum: [
            "PRESENTADO",
            "INTERESADO",
            "EN_DUDA",
            "EN_NEGOCIACION",
            "ACEPTADO",
            "PERDIDO",
          ],
        },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "pacientes_pendientes_pago",
    description:
      "Lista pacientes con presupuesto Aceptado pero con saldo Pendiente>0. Útil para " +
      "preguntas tipo 'pacientes que no han pagado todavía'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
  },
  {
    name: "kpis_resumen_clinica",
    description:
      "Devuelve KPIs operativos del periodo: leads totales, pacientes nuevos, presupuestos " +
      "aceptados, importe aceptado, tasa conversión. Si admin, agrega por clínica.",
    input_schema: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: ["hoy", "semana", "mes"],
          description: "Periodo a calcular. Por defecto 'mes'.",
        },
      },
    },
  },
  {
    name: "ranking_doctores",
    description:
      "Ranking de doctores por métrica en el periodo. Métrica conversion = " +
      "ACEPTADO/(ACEPTADO+PERDIDO+EN_DUDA). volumen = nº de presupuestos.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["conversion", "volumen"] },
        periodo: { type: "string", enum: ["semana", "mes"], description: "Por defecto 'mes'." },
        limit: { type: "number", description: "Top/bottom N. Por defecto 5." },
      },
      required: ["metric"],
    },
  },
  {
    name: "mensajes_recientes",
    description:
      "Devuelve los últimos mensajes WhatsApp de un lead o presupuesto concreto. Pásale " +
      "leadId O presupuestoId, no ambos.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        presupuestoId: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  // ── Sprint 14b Bloque 8 — modulo financiero ──────────────────────────
  {
    name: "get_pagos_pendientes_clinica",
    description:
      "Lista pacientes con presupuesto firmado (Aceptado=Si) y saldo Pendiente>0. " +
      "Opcionalmente filtra a los que llevan al menos N días sin movimiento " +
      "(diasAtraso = días desde el último pago, o desde Fecha_Aceptado si nunca pagaron). " +
      "Devuelve nombre, pacienteId, importeTotal, importePagado, importePendiente, " +
      "diasSinPagar, ultimoPagoFecha. Limit 20.",
    input_schema: {
      type: "object",
      properties: {
        diasAtraso: {
          type: "number",
          description:
            "Filtra pacientes con días sin pagar >= N. Omitir para devolver TODOS los pendientes.",
        },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_cobros_vencidos",
    description:
      "Lista pacientes con liquidación VENCIDA: presupuesto Aceptado + Fecha_Aceptado + " +
      "plazo (de Configuraciones_Clinica.Plazos_Liquidacion, default 90d) ya pasada, sin " +
      "pago tipo Liquidación registrado. Devuelve nombre, pacienteId, importePendiente, " +
      "fechaAceptado, plazoDias, diasVencido. Ordenado por diasVencido descendente.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_facturado_periodo",
    description:
      "Suma de pagos en un periodo. Devuelve total facturado (€) + número de pagos + " +
      "número de pacientes únicos. Filtra por clínica seleccionada (si admin con clínica) o " +
      "por las clínicas accesibles del coord. Útil para 'cuánto facturé esta semana/mes'.",
    input_schema: {
      type: "object",
      properties: {
        fecha_inicio: { type: "string", description: "ISO YYYY-MM-DD" },
        fecha_fin: { type: "string", description: "ISO YYYY-MM-DD" },
      },
      required: ["fecha_inicio", "fecha_fin"],
    },
  },
  {
    name: "get_top_pacientes_facturado",
    description:
      "Ranking pacientes por facturación (suma Pagos_Paciente.Importe), descendente. " +
      "Devuelve top N con nombre, pacienteId, totalFacturado, numPagos. Por defecto N=10. " +
      "Si pasas periodo, filtra los pagos a ese rango.",
    input_schema: {
      type: "object",
      properties: {
        n: { type: "number", description: "Top N. Por defecto 10." },
        fecha_inicio: { type: "string", description: "ISO YYYY-MM-DD (opcional)" },
        fecha_fin: { type: "string", description: "ISO YYYY-MM-DD (opcional)" },
      },
    },
  },
];

// ═══ ACTION TOOLS (no se ejecutan en backend; se devuelven al frontend) ═══

export const ACTION_TOOL_NAMES = [
  "cambiar_estado_lead",
  "marcar_lead_llamado",
  "enviar_whatsapp_lead",
  "enviar_whatsapp_presupuesto",
  "anadir_nota_lead",
  "anadir_nota_presupuesto",
  "cambiar_estado_presupuesto",
  "marcar_atendido_actuar_hoy",
  // Sprint 14b Bloque 8 — modulo financiero.
  "enviar_recordatorio_pago",
  "marcar_pago_recibido",
  "agendar_llamada_cobranza",
] as const;

export type ActionToolName = (typeof ACTION_TOOL_NAMES)[number];

export const ACTION_TOOLS: AnthropicTool[] = [
  {
    name: "cambiar_estado_lead",
    description:
      "Sugiere cambiar el estado de un lead. Estados válidos: Nuevo, Contactado, Citado, " +
      "No Interesado. Si destino es 'No Interesado', incluir motivoNoInteres " +
      "(Rechazo_Producto o No_Asistio).",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        nombreLead: { type: "string", description: "Solo display, para construir el botón." },
        nuevoEstado: {
          type: "string",
          enum: ["Nuevo", "Contactado", "Citado", "No Interesado"],
        },
        motivoNoInteres: {
          type: "string",
          enum: ["Rechazo_Producto", "No_Asistio"],
        },
      },
      required: ["leadId", "nuevoEstado"],
    },
  },
  {
    name: "marcar_lead_llamado",
    description: "Sugiere marcar el lead como llamado=true y registrar Llamada realizada.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        nombreLead: { type: "string" },
      },
      required: ["leadId"],
    },
  },
  {
    name: "enviar_whatsapp_lead",
    description:
      "Sugiere enviar un mensaje WhatsApp a un lead. El mensaje DEBE estar redactado por " +
      "ti según las reglas del sistema. El usuario verá el preview y confirmará.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        nombreLead: { type: "string" },
        mensaje: { type: "string", description: "Mensaje completo redactado." },
      },
      required: ["leadId", "mensaje"],
    },
  },
  {
    name: "enviar_whatsapp_presupuesto",
    description:
      "Sugiere enviar un mensaje WhatsApp a un paciente con presupuesto activo. El mensaje " +
      "DEBE estar redactado por ti.",
    input_schema: {
      type: "object",
      properties: {
        presupuestoId: { type: "string" },
        nombrePaciente: { type: "string" },
        mensaje: { type: "string" },
      },
      required: ["presupuestoId", "mensaje"],
    },
  },
  {
    name: "anadir_nota_lead",
    description: "Sugiere añadir una nota interna al lead (append a campo Notas).",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        nombreLead: { type: "string" },
        nota: { type: "string", description: "Texto de la nota." },
      },
      required: ["leadId", "nota"],
    },
  },
  {
    name: "anadir_nota_presupuesto",
    description: "Sugiere añadir una nota interna al presupuesto.",
    input_schema: {
      type: "object",
      properties: {
        presupuestoId: { type: "string" },
        nombrePaciente: { type: "string" },
        nota: { type: "string" },
      },
      required: ["presupuestoId", "nota"],
    },
  },
  {
    name: "cambiar_estado_presupuesto",
    description:
      "Sugiere mover un presupuesto a otro estado. Estados válidos: PRESENTADO, " +
      "INTERESADO, EN_DUDA, EN_NEGOCIACION, ACEPTADO, PERDIDO. Si PERDIDO, incluir motivoPerdida.",
    input_schema: {
      type: "object",
      properties: {
        presupuestoId: { type: "string" },
        nombrePaciente: { type: "string" },
        nuevoEstado: {
          type: "string",
          enum: [
            "PRESENTADO",
            "INTERESADO",
            "EN_DUDA",
            "EN_NEGOCIACION",
            "ACEPTADO",
            "PERDIDO",
          ],
        },
        motivoPerdida: { type: "string" },
      },
      required: ["presupuestoId", "nuevoEstado"],
    },
  },
  {
    name: "marcar_atendido_actuar_hoy",
    description:
      "Sugiere marcar a un lead/presupuesto como atendido en Actuar Hoy. Registra una " +
      "acción tipo 'Llamada' con notas 'Atendido vía Copilot'. NO cambia estado, solo " +
      "suma a 'completadas hoy' por timestamp.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["lead", "presupuesto"] },
        id: { type: "string" },
        nombre: { type: "string" },
      },
      required: ["kind", "id"],
    },
  },
  // ── Sprint 14b Bloque 8 — modulo financiero ──────────────────────────
  {
    name: "enviar_recordatorio_pago",
    description:
      "Sugiere enviar un recordatorio de pago WhatsApp a un paciente usando una plantilla " +
      "concreta (recordatorio_senal / recordatorio_primer_pago / recordatorio_liquidacion). " +
      "El sistema renderiza la plantilla con datos reales del paciente y muestra el " +
      "preview para que el usuario confirme. Solo al confirmar se envía via Twilio.",
    input_schema: {
      type: "object",
      properties: {
        pacienteId: { type: "string" },
        nombrePaciente: { type: "string", description: "Display, para construir el botón." },
        plantillaId: {
          type: "string",
          description:
            "Record id de la plantilla en Plantillas_Mensaje. Pásalo desde una read-tool " +
            "previa o desde el contexto del usuario.",
        },
        plantillaNombre: {
          type: "string",
          description:
            "Display alternativo cuando no tengas el id (recordatorio_senal, etc.). El " +
            "sistema resolverá por nombre + scope clínica.",
        },
      },
      required: ["pacienteId"],
    },
  },
  {
    name: "marcar_pago_recibido",
    description:
      "Sugiere registrar un pago recibido. El sistema muestra preview con paciente, importe, " +
      "tipo (Senal / Primer_Pago_Plan / Liquidacion), método y fecha. Solo al confirmar se " +
      "crea via POST /api/pacientes/[id]/pagos. NO ejecutar sin confirmación humana.",
    input_schema: {
      type: "object",
      properties: {
        pacienteId: { type: "string" },
        nombrePaciente: { type: "string" },
        importe: { type: "number", description: "Importe en EUR > 0." },
        tipo: {
          type: "string",
          enum: ["Senal", "Primer_Pago_Plan", "Liquidacion"],
        },
        metodo: {
          type: "string",
          description:
            "Método de pago (Tarjeta, Efectivo, Transferencia, Bizum, Financiación externa, etc.).",
        },
        fechaPago: {
          type: "string",
          description: "ISO YYYY-MM-DD. Por defecto hoy si se omite.",
        },
        nota: { type: "string" },
      },
      required: ["pacienteId", "importe", "tipo"],
    },
  },
  {
    name: "agendar_llamada_cobranza",
    description:
      "Sugiere agendar una llamada futura de cobranza a un paciente. Registra una entrada " +
      "en Acciones_Pago tipo 'Llamada agendada' con la fecha/hora y la nota. NO realiza la " +
      "llamada — solo crea el recordatorio interno.",
    input_schema: {
      type: "object",
      properties: {
        pacienteId: { type: "string" },
        nombrePaciente: { type: "string" },
        fechaHora: {
          type: "string",
          description: "ISO datetime YYYY-MM-DDTHH:MM:SS o YYYY-MM-DD (asumimos 09:00).",
        },
        nota: { type: "string" },
      },
      required: ["pacienteId", "fechaHora"],
    },
  },
];

export const ALL_TOOLS: AnthropicTool[] = [...READ_TOOLS, ...ACTION_TOOLS];
