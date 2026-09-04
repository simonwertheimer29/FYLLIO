#!/usr/bin/env tsx
// QA del coste por turno (31-08): módulo puro, precios declarados en USD.
import { costeUsdDeTurno, sumarCosteUsd } from "../app/lib/agente/coste";
let fallos = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fallos++; };
const haiku = "claude-haiku-4-5-20251001";
ok(costeUsdDeTurno({ inputTokens: 1_000_000, outputTokens: 0 }, haiku) === 1.0, "1M tokens de entrada en haiku = 1,00 USD");
ok(costeUsdDeTurno({ inputTokens: 0, outputTokens: 1_000_000 }, haiku) === 5.0, "1M de salida en haiku = 5,00 USD");
ok(costeUsdDeTurno({ inputTokens: 0, outputTokens: 0, cacheLectura: 1_000_000 }, haiku) === 0.1, "la lectura de caché se tarifa al 10 %");
ok(costeUsdDeTurno({ inputTokens: 1800, outputTokens: 250, cacheLectura: 1200 }, haiku) === 0.00317, "un turno típico ≈ 0,003 USD");
ok(costeUsdDeTurno({ inputTokens: 100, outputTokens: 10 }, "modelo-inventado") === null, "modelo desconocido NO se tarifa a ojo: null");
ok(costeUsdDeTurno(undefined, haiku) === null, "sin usage: null (turno anterior a la instrumentación)");
const s = sumarCosteUsd([{ usage: { inputTokens: 1000, outputTokens: 100 }, modelo: haiku }, { usage: undefined, modelo: haiku }, { usage: { inputTokens: 1, outputTokens: 1 }, modelo: "x" }]);
ok(s.turnos === 3 && s.sinTarifa === 2 && s.usd === 0.0015, `la suma separa lo tarifado de lo no tarifable (${JSON.stringify(s)})`);
console.log(fallos === 0 ? "\n✓ QA coste: todo verde." : `\n✗ ${fallos} fallos.`);
process.exit(fallos === 0 ? 0 : 1);
