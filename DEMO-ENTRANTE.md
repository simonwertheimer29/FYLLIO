# Ver el agente funcionando en la DEMO — `demo:entrante`

La herramienta para **comprobar el agente sin pedir un informe**: simula un mensaje
entrante de WhatsApp en la DEMO, lo evalúa por el mismo camino que producción, y cuenta
en frases qué entendió, qué decidió, qué anotó y qué borrador propone.

Hace exactamente lo que hace el webhook con el interruptor encendido — registra el
mensaje y llama al evaluador real. **Cero lógica propia**: si esto funciona, el webhook
funciona. Nada sale por WhatsApp real (modo A + la DEMO no tiene número conectado), así
que es imposible molestar a nadie. Coste: ~medio céntimo por mensaje.

## Uso

```bash
# Ver los interruptores (una clínica = un interruptor, apagado por defecto)
npm run demo:entrante -- --estado

# Encender / apagar una clínica
npm run demo:entrante -- --on norte
npm run demo:entrante -- --off norte

# Simular un entrante (el número decide el hilo; el texto es el mensaje)
npm run demo:entrante -- "+34 613 128 152" "Hola, ¿me recordáis el importe del presupuesto?"

# Número nuevo sin hilo previo: decir qué clínica lo recibe (y opcionalmente el
# nombre de perfil de WhatsApp que Meta mandaría)
npm run demo:entrante -- "+34699111222" "¿Hacéis ortodoncia invisible?" --clinica norte --nombre "Ana R."
```

Limpieza total (mensajes, evaluaciones e interruptores): `npm run demo:reset`.

## Dónde se ve en pantalla (con `npm run dev` corriendo)

| Qué | Dónde |
|---|---|
| El borrador del agente | /presupuestos → pestaña **Intervención** (solo hilos con presupuesto vivo) |
| El caso derivado | Misma tarjeta: «requiere persona», urgencia CRÍTICO (prioritaria) o ALTO (normal), y el motivo. En /mensajeria el hilo sale marcado «necesita persona» |
| El aviso urgente | La campanita: «Atención inmediata». **Solo** cola prioritaria — push por un caso normal = bug |
| Lo anotado pendiente | **Sin pantalla todavía** (fase D). Se ve en la salida de la herramienta |
| Huérfanos y leads | El hilo en /mensajeria; su evaluación, solo en la terminal |

## Los 4 casos que enseñan comportamientos distintos

Con **Norte encendida** y las demás apagadas. Pacientes reales del seed (estables entre
reseeds). El orden importa: una derivación es **definitiva** para el hilo (no-reversión),
por eso Carlos hace primero el caso 1 y luego el 3.

**1 · Resuelve solo** — Carlos Herrera, presupuesto vivo de 300 €:
```bash
npm run demo:entrante -- "+34 613 128 152" "Hola, ¿me podéis recordar cuánto era el presupuesto que me disteis?"
```
Esperado: SIGUE, responde con el importe (informar de lo emitido no compromete nada),
nada pendiente, sin derivar.

**2 · Anota algo y sigue** — Elena Navarro, presupuesto vivo de 4.200 €:
```bash
npm run demo:entrante -- "+34 614 135 165" "Una pregunta, ¿los 4.200 € llevan el IVA incluido?"
```
Esperado: SIGUE, pero anota pendiente «dato del presupuesto que falta» (el IVA no consta
en el sistema) y el borrador dice que se lo confirman — sin inventarse la respuesta.

**3 · Deriva por urgencia** — Carlos otra vez, después del caso 1:
```bash
npm run demo:entrante -- "+34 613 128 152" "Me sacaron una muela ayer y no para de sangrar, estoy asustado"
```
Esperado: DERIVA, cola PRIORITARIA, push «Atención inmediata», tarjeta CRÍTICO, y un
borrador que acompaña y remite a la clínica **sin afirmar nada clínico**.

**4 · Número desconocido**:
```bash
npm run demo:entrante -- "+34699111222" "Hola, ¿hacéis ortodoncia invisible? ¿Qué precio tiene más o menos?" --clinica norte --nombre "Ana R."
```
Esperado: SIGUE con objetivo «saber quién es» — invita a identificarse/primera visita
**sin inventar un precio** y sin anotar pendiente (un precio sin presupuesto emitido no
se aplaza: no hay documento que consultar).

## Señales de que algo falló

- **«El evaluador no pudo evaluar»** → el modelo falló y el caso subió a persona
  (fail-closed). Una vez es azar; en cada mensaje, está roto.
- **«El borrador del modelo se descartó»** → el juez cazó una regla dura. Una vez es la
  guarda funcionando; en cada mensaje, el generador se degradó.
- **Push en los casos 1, 2 o 4** → bug directo del criterio de cola.
- **El script casca con error de conexión o de entorno** → sale con su motivo; no hay
  fallo silencioso.

## Qué NO es esta herramienta

No es QA (eso es `npm run qa:entrante` y compañía) y no toca producción: solo DEMO, y el
interruptor de cada clínica real seguirá apagado hasta que se decida encenderlo.
