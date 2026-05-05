# Arquitectura de Agenda — foundational (Sprint 16a Bloque 5)

Este documento describe la arquitectura preparada para el módulo de agenda
de Fyllio. Sprint 16a Bloque 5 deja **schema + interfaz + docs**, sin
adapters ni endpoints ni UI. La implementación efectiva queda diferida a
Sprint 19+, cuando la validación R2b con Gesden haya cerrado qué escenario
prevalece en los pilotos reales.

## Por qué foundational ahora

La decisión "cómo se gestiona la agenda" es la que más cambia según el
piloto: una clínica con Gesden activo no necesita ni quiere que Fyllio
sea fuente de verdad; otra sin software clínico podría usar Fyllio como
agenda nativa; una tercera querrá un híbrido. Hardcodear cualquier camino
hoy nos haría reabrir el módulo dos veces.

Lo que ya **no se puede hacer tarde** sin coste alto:

- Tener el campo `Origen_Sistema` en cada cita desde el día uno.
- Reservar nombres canónicos para las operaciones comunes.
- Documentar los 4 escenarios para que cualquier sprint futuro encaje en
  uno conocido.

Lo que **sí se puede dejar para Sprint 19+**:

- Adapters concretos.
- Endpoints REST.
- UI de calendario/slots.

## Los 4 escenarios

### 1. `fyllio_native`

Fyllio es la **única fuente de verdad** para la agenda. La clínica no
tiene software clínico o decide migrar.

- Lectura/escritura de citas: directo en Airtable (`Citas`).
- Slots disponibles: derivados de huecos libres entre citas + horario
  laboral del doctor.
- `Origen_Sistema = "fyllio_native"`.
- `Sync_Status = "not_applicable"` siempre.

Adapter: `FyllioNativeAdapter` (futuro).

### 2. `gesden_synced`

Gesden (o Cliniweb / DentalWeb / Klinikare / etc.) es la fuente de
verdad. Fyllio sincroniza en una dirección o las dos según conector.

- Lectura: pull periódico desde Gesden API → escribe en `Citas` con
  `Origen_Sistema = "gesden_synced"`, `External_Id = id_gesden`,
  `Sync_Status = "synced"`, `Last_Sync_At` actualizado.
- Escritura desde Fyllio: si el conector lo permite, push a Gesden y
  esperar webhook de confirmación; mientras tanto `Sync_Status = "pending"`.
- Conflictos: el sistema externo gana siempre (Fyllio es espejo).

Adapter: `GesdenSyncedAdapter` (futuro, depende de R2b).

### 3. `external_manual`

La clínica usa otro software clínico SIN integración API disponible. El
admin/coord introduce las citas a mano en Fyllio para que el módulo
financiero, los presupuestos y el Copilot sepan de ellas.

- `Origen_Sistema = "external_manual"`, `External_Id = null`,
  `Sync_Status = "not_applicable"`.
- Fyllio no genera slots (no conoce el horario real); solo guarda lo
  que la coord captura.

Adapter: `ExternalManualAdapter` (futuro, trivial — equivale a
fyllio_native con sync deshabilitado).

### 4. `hybrid`

Algunas clínicas tendrán doctores en Gesden + recepcionistas que reciben
leads desde Fyllio y agendan ahí mismo. La cita "vive" en ambos lados con
política de reconciliación.

- Citas creadas desde Fyllio nacen `Origen_Sistema = "fyllio_native"`,
  `Sync_Status = "pending"` mientras se hace push a Gesden. Tras
  confirmación cambian a `gesden_synced`.
- Citas que llegan desde Gesden: idem `gesden_synced`.
- Reconciliación periódica detecta divergencias por `External_Id`.

Adapter: `HybridAdapter` (futuro, depende de Gesden API).

## Cuándo se usa cada uno

La elección se decide a nivel de **clínica**, no de cita. Cada clínica
configura su `Sistema_Agenda` (campo futuro en `Clínicas` o
`Configuraciones_Clinica` con categoría nueva). El adapter se selecciona
desde un factory en `lib/agenda/factory.ts` (futuro):

```ts
// futuro
function getAdapter(clinicaId: string): SistemaAgenda {
  const sistema = await getConfigClinica(clinicaId, "Sistema_Agenda");
  switch (sistema) {
    case "gesden_synced":   return new GesdenSyncedAdapter(clinicaId);
    case "external_manual": return new ExternalManualAdapter(clinicaId);
    case "hybrid":          return new HybridAdapter(clinicaId);
    case "fyllio_native":
    default:                return new FyllioNativeAdapter(clinicaId);
  }
}
```

## Roadmap

| Sprint | Entregable |
|---|---|
| 16a.5 (este) | Schema preparado + interfaz `SistemaAgenda` + este documento |
| 19 (tentative) | Primer adapter — el que pida el primer piloto R2b. Probable: `external_manual` (más sencillo) o `fyllio_native` (más útil) |
| 20+ | `gesden_synced` o `hybrid` según ROI demostrado del piloto |

## Schema actual (post-Sprint 16a.5)

Tabla `Citas` (existente desde Sprint 1, ampliada en 16a.5):

Campos legacy que **se conservan**: `Paciente`, `Profesional`, `Clínica`,
`Tratamiento`, `Sillón`, `Hora inicio`, `Hora final`, `Estado`, `Origen`
(canal de captación, NO sistema), `Notas`, `Acciones`, etc.

Campos foundational añadidos en 16a.5:

- `Origen_Sistema` singleSelect — fyllio_native / gesden_synced /
  external_manual / sin_definir (default para records legacy).
- `External_Id` singleLineText — id en sistema externo.
- `Sync_Status` singleSelect — pending / synced / error /
  not_applicable.
- `Last_Sync_At` dateTime.
- `Duracion_Min` number — derivable pero útil como snapshot.
- `Created_At` dateTime — explícito para sort/auditoría.

## Importante

- **No implementar adapters en Sprint 16a.** Solo schema + interfaz.
- El adapter primero (Sprint 19+) hará el backfill de
  `Origen_Sistema = "sin_definir" → "fyllio_native"` o el que
  corresponda según la clínica.
- La interfaz `SistemaAgenda` puede ampliarse en sprints futuros, pero
  los 4 métodos actuales (`listarSlotsDisponibles`, `crearCita`,
  `cancelarCita`, `obtenerCita`) son el contrato mínimo y NO deben
  romperse.
