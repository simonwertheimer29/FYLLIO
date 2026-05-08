# Voice IA con Vapi — arquitectura (Sprint 17)

Sprint 17 entrega el **Use Case 1: confirmación de citas 24h antes**. Use Cases
2 (reactivación) y 3 (recuperación de presupuestos) quedan para Sprint 18 y
reutilizan toda la infraestructura descrita aquí.

## Flujo end-to-end

```
┌──────────────────────────┐
│ /api/cron/daily          │ corre 1×/día a las 07:00 UTC
│ (Vercel cron)            │
└────────────┬─────────────┘
             │ busca Citas Estado=Pendiente entre now+23h y now+25h
             ▼
┌──────────────────────────┐
│ iniciarLlamada()         │ lib/llamadas/iniciar.ts
│ — salvaguardas:          │
│   · paciente_sin_telefono│
│   · paciente_optout      │
│   · cooldown 24h         │
│   · cooldown 1×/dia      │
│   · fuera_horario        │
│   · limite_clinica       │
│   · pausa_automatica     │
└────────────┬─────────────┘
             │ si pasa todas
             ▼
┌──────────────────────────┐         ┌─────────────┐
│ crearLlamada()           │────────▶│  Vapi API   │
│ lib/vapi/client.ts       │  POST   │  /call/phone│
└────────────┬─────────────┘         └──────┬──────┘
             │                              │
             │ persiste Llamadas_Vapi       │ Vapi marca el teléfono
             │ (estado=iniciada)            │ del paciente y dispara
             ▼                              │ webhooks de vuelta a Fyllio
        ┌──────────┐                        │
        │ Airtable │                        │
        └──────────┘                        ▼
                                    ┌──────────────────────────┐
                                    │ POST /api/webhooks/vapi  │
                                    │ — verifica HMAC          │
                                    │ — switch event.type:     │
                                    │   · status-update        │
                                    │   · tool-calls           │
                                    │     (registrar_resultado)│
                                    │   · end-of-call-report   │
                                    └────────────┬─────────────┘
                                                 │
                                                 │ side-effects:
                                                 │  · confirmada → Cita.Estado="Confirmada"
                                                 │  · cancelada → Cita.Estado="Cancelada"
                                                 │     + alerta coord urgencia=alta
                                                 │  · reagenda → alerta coord urgencia=alta
                                                 │  · escalado → alerta coord urgencia=alta
                                                 ▼
                                          ┌─────────────┐
                                          │ Airtable    │
                                          │ Llamadas    │
                                          │ Alertas     │
                                          │ Citas       │
                                          └─────────────┘
```

## Componentes

| Capa | Archivos | Responsabilidad |
|---|---|---|
| Schema | `app/scripts/sprint17-bloque1-schema.ts` | Crea `Llamadas_Vapi` en Airtable |
| Tipos | `app/lib/vapi/types.ts`, `app/lib/llamadas/types.ts` | Shape Vapi + dominio interno |
| Cliente Vapi | `app/lib/vapi/client.ts` | `crearLlamada`, `obtenerLlamada`, `cancelarLlamada` |
| Repo | `app/lib/llamadas/repo.ts` | CRUD Llamadas_Vapi + queries de salvaguardas |
| Motor | `app/lib/llamadas/iniciar.ts` | `iniciarLlamada()` con pipeline completo |
| Endpoint manual | `app/api/llamadas/iniciar/route.ts` | POST para test desde UI o copilot |
| Cron diario | `app/api/cron/daily/route.ts` (extensión) | Ejecuta confirmaciones a las 7h UTC |
| Webhook | `app/api/webhooks/vapi/route.ts` | Procesa eventos Vapi + side-effects |
| UI panel | `app/(authed)/llamadas/{page,LlamadasView}.tsx` | KPIs + tabla + drawer |
| UI config | `app/(authed)/ajustes/configuracion/LlamadasIaPanel.tsx` | Toggle + horario + límite + voz por clínica |
| Tools Copilot | `app/lib/copilot/tools-{spec,exec}.ts`, `actions-exec.ts` | `consultar_llamadas_recientes` (read), `iniciar_llamada_confirmacion` (action) |

## Variables de entorno

Configurar en **Vercel → Settings → Environment Variables** (Production +
Preview):

| Variable | Valor | Notas |
|---|---|---|
| `VAPI_API_KEY` | (Vapi dashboard → API Keys) | Bearer auth para todas las llamadas a la API Vapi |
| `VAPI_PHONE_NUMBER_ID` | (Vapi dashboard → Phone Numbers → ID) | Número saliente registrado en Vapi |
| `VAPI_ASSISTANT_ID_CONFIRMACION_CITAS` | (Vapi dashboard → Assistants → ID) | Assistant configurado con prompt + tool `registrar_resultado` |
| `VAPI_WEBHOOK_SECRET` | `6467799d4fa3355dc67d7ba5602f0f08e242f276488c8f1ef5d42824a855c600e3d0b78d8eaf80c9b039ed78b50d566c` | **Generado en Sprint 17.** Configurar en Vapi dashboard → Webhooks → Signing Secret. Sin esto, el endpoint webhook rechaza 401. |

Para Sprint 18:
- `VAPI_ASSISTANT_ID_REACTIVACION`
- `VAPI_ASSISTANT_ID_RECUPERACION`

## Configuración Vapi assistant (manual, fuera del repo)

El assistant `confirmacion_citas` debe:

1. Tener configurado el `firstMessage` por defecto (override por clínica
   desde `/ajustes/configuracion → Llamadas IA → Mensaje personalizado`).
2. Exponer una **function tool** llamada exactamente `registrar_resultado`
   con este schema:

   ```json
   {
     "name": "registrar_resultado",
     "description": "Llamar al final de la conversación con el resultado.",
     "parameters": {
       "type": "object",
       "properties": {
         "resultado": {
           "type": "string",
           "enum": [
             "confirmada",
             "reagenda_solicitada",
             "cancelada",
             "no_contesta",
             "escalado_humano"
           ]
         },
         "notas": { "type": "string" }
       },
       "required": ["resultado"]
     }
   }
   ```

3. El system prompt del assistant debe instruir explícitamente:
   *"Al cerrar la conversación, llama a la function `registrar_resultado`
   con el resultado apropiado antes de despedirte."*

## Coste estimado

Por llamada de confirmación (duración típica 60-120 segundos):

| Componente | Coste aproximado |
|---|---|
| Vapi platform fee | $0.05 |
| LLM (gpt-4o-mini) | $0.02-0.05 |
| TTS (Vapi voice) | $0.04-0.20 según voz |
| STT (Deepgram) | $0.01-0.02 |
| Telefonía (Vapi outbound) | $0.01-0.03 |
| **Total por llamada** | **~$0.15-0.35** |

50 llamadas/día × $0.25 = **~$12.50/día por clínica** o ~$375/mes.

## Cómo añadir Use Cases nuevos en Sprint 18

El motor está agnostic al `tipo` de llamada:

1. **Crear el assistant en Vapi** con prompt específico (ej. reactivación
   pacientes inactivos 60+ días).
2. **Añadir env var** `VAPI_ASSISTANT_ID_REACTIVACION`.
3. **Triggers**:
   - Si es event-based: integrar en código que detecta el evento
     llamando `iniciarLlamada({citaId?, tipo: "reactivacion", ...})`.
   - Si es time-based: añadir bloque al cron daily o crear cron nuevo.
4. **Persistir en `Llamadas_Vapi`**: el repo ya distingue por
   `Tipo_Llamada`. Sin cambios.
5. **UI**: el panel `/llamadas` ya filtra por tipo (los selects son
   genéricos). Solo añadir labels en `LlamadasView.tsx` si el `tipo`
   distinto necesita un display nombre custom.
6. **Tools Copilot**: añadir un tool específico
   `iniciar_llamada_reactivacion` o ampliar el actual con un parámetro
   `tipo`.

El webhook handler procesa cualquier `tipo` igual — el side-effect
`Cita.Estado="Confirmada"` solo aplica si `citaId` está enlazada,
así que reactivaciones (sin cita) no disparan ese update.

## Observabilidad

- **Logs Vercel**: `[daily voice]`, `[llamadas iniciar]`,
  `[webhooks/vapi]`, `[llamadas alerta pausa]`.
- **UI `/llamadas`**: KPIs hero (hoy + mes) + sección de tabla con
  filtros + drawer con transcript completa.
- **Airtable `Llamadas_Vapi`**: source of truth de cada llamada con
  estado, resultado, duración, coste, transcript.
- **Airtable `Alertas_Enviadas`**: alertas a coord cuando paciente
  cancela vía IA, pide reagendar, pide escalado humano, o cuando se
  dispara la pausa automática.

## Salvaguardas (referencia rápida)

| Salvaguarda | Configurable | Default | Donde se aplica |
|---|---|---|---|
| Sin teléfono | n/a | siempre | iniciarLlamada |
| Opt-out paciente | `Pacientes.Optout_Automatizaciones` | false | iniciarLlamada |
| Cooldown 24h | n/a | 24h | iniciarLlamada |
| Cooldown 1×/día/paciente | n/a | siempre | iniciarLlamada |
| Activar/desactivar por clínica | UI ajustes | activo | iniciarLlamada |
| Ventana horaria | UI ajustes | 10:00-19:00 | iniciarLlamada |
| Horario laboral clínica | `Configuraciones_Clinica` | lun-vie 09-20 | iniciarLlamada |
| Límite/día clínica | UI ajustes | 50 | iniciarLlamada |
| Pausa automática | n/a | >=5 muestras + >=20% fallidas última hora | iniciarLlamada |

## Limitaciones conocidas Sprint 17

- **El límite por clínica usa el total global**. Cuando haya múltiples
  clínicas en una misma base Airtable, hay que filtrar `contarLlamadasHoy()`
  por clinicaId via join con Pacientes. Documentado en código.
- **No hay reintentos automáticos**. Si Vapi devuelve error o la llamada
  falla (estado=fallida), el reintento es manual desde UI (drawer →
  botón Reintentar) o vía endpoint `POST /api/llamadas/[id]/reintentar`.
- **Cron 1×/día**. Una cita confirmada que entra en la ventana 23-25h
  fuera de la ejecución de las 7h UTC no se llama. Workaround: ampliar
  a `now+12h..now+36h` cuando se note el problema.
- **WebRTC / SIP / direct dial**: no soportados. Solo Vapi cloud calling.
