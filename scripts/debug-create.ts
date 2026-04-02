import Airtable from 'airtable';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envContent = readFileSync(resolve('.env.local'), 'utf-8');
for (const line of envContent.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq < 0) continue;
  const key = t.slice(0, eq).trim();
  const val = t.slice(eq + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

Airtable.configure({ apiKey: process.env.AIRTABLE_API_KEY! });
const base = Airtable.base(process.env.AIRTABLE_BASE_ID!);

async function testPres(fields: Record<string, unknown>, label: string) {
  try {
    const rec = await base('Presupuestos').create(fields as any);
    console.log(`✅ PRES ${label}: OK (${rec.id})`);
    await base('Presupuestos').destroy(rec.id);
    return rec.id;
  } catch (err: any) {
    console.error(`❌ PRES ${label}: ${err.statusCode} — ${err.message}`);
    if (err.error) console.error('   Detail:', JSON.stringify(err.error));
    return null;
  }
}

async function testCont(fields: Record<string, unknown>, label: string, presId?: string) {
  let pres: any = null;
  if (!presId) {
    // create a temporary presupuesto to link to
    try {
      pres = await base('Presupuestos').create({
        Tratamiento_nombre: 'DEBUG', Estado: 'ACEPTADO', Fecha: '2025-01-01'
      } as any);
    } catch (err: any) {
      console.error(`❌ CONT ${label}: could not create temp presupuesto: ${err.message}`);
      return;
    }
  }
  const targetId = presId ?? pres.id;
  try {
    const rec = await base('Contactos_Presupuesto').create({ PresupuestoId: targetId, ...fields } as any);
    console.log(`✅ CONT ${label}: OK (${rec.id})`);
    await base('Contactos_Presupuesto').destroy(rec.id);
  } catch (err: any) {
    console.error(`❌ CONT ${label}: ${err.statusCode} — ${err.message}`);
    if (err.error) console.error('   Detail:', JSON.stringify(err.error));
  } finally {
    if (pres) await base('Presupuestos').destroy(pres.id).catch(() => {});
  }
}

async function main() {
  console.log('\n=== PRESUPUESTOS — remaining fields ===');
  // Test fields not previously tested
  await testPres({ Tratamiento_nombre: 'T9',  Estado: 'ACEPTADO', Fecha: '2025-01-01', Doctor: 'Dr. García' }, '+Doctor');
  await testPres({ Tratamiento_nombre: 'T10', Estado: 'ACEPTADO', Fecha: '2025-01-01', OrigenLead: 'google_ads' }, '+OrigenLead');
  await testPres({ Tratamiento_nombre: 'T11', Estado: 'ACEPTADO', Fecha: '2025-01-01', ContactCount: 2 }, '+ContactCount');
  await testPres({ Tratamiento_nombre: 'T12', Estado: 'ACEPTADO', Fecha: '2025-01-01', Notas: '[SEED_HIST]' }, '+Notas');

  console.log('\n=== PRESUPUESTOS — full combined fields ===');
  await testPres({
    Tratamiento_nombre:  'T-FULL',
    Importe:             1500,
    Estado:              'ACEPTADO',
    Fecha:               '2025-01-01',
    Doctor:              'Dr. García',
    Doctor_Especialidad: 'Implantólogo',
    Clinica:             'Clínica Madrid Centro',
    TipoPaciente:        'Privado',
    TipoVisita:          'Primera Visita',
    FechaAlta:           '2025-01-01',
    OrigenLead:          'google_ads',
    ContactCount:        2,
    Notas:               '[SEED_HIST]',
  }, 'ALL fields combined');

  console.log('\n=== PRESUPUESTOS — full combined with MotivoPerdida ===');
  await testPres({
    Tratamiento_nombre:  'T-FULL-PERD',
    Importe:             1500,
    Estado:              'PERDIDO',
    Fecha:               '2025-01-01',
    Doctor:              'Dr. García',
    Doctor_Especialidad: 'General',
    Clinica:             'Clínica Salamanca',
    TipoPaciente:        'Adeslas',
    TipoVisita:          'Paciente con Historia',
    FechaAlta:           '2025-01-01',
    OrigenLead:          'referido_paciente',
    ContactCount:        3,
    Notas:               '[SEED_HIST]',
    MotivoPerdida:       'precio_alto',
  }, 'ALL fields + PERDIDO');

  console.log('\n=== CONTACTOS_PRESUPUESTO — individual fields ===');
  await testCont({ TipoContacto: 'whatsapp', Resultado: 'acordó cita', FechaHora: '2025-01-02T10:00:00.000Z' }, 'minimal');
  await testCont({ TipoContacto: 'whatsapp', Resultado: 'acordó cita', FechaHora: '2025-01-02T10:00:00.000Z', MensajeIAUsado: true }, '+MensajeIAUsado');
  await testCont({ TipoContacto: 'whatsapp', Resultado: 'acordó cita', FechaHora: '2025-01-02T10:00:00.000Z', TonoUsado: 'empatico' }, '+TonoUsado');
  await testCont({ TipoContacto: 'whatsapp', Resultado: 'acordó cita', FechaHora: '2025-01-02T10:00:00.000Z', Nota: '[SEED_HIST] tono:empatico' }, '+Nota');

  console.log('\n=== CONTACTOS_PRESUPUESTO — full combined ===');
  await testCont({
    TipoContacto:   'whatsapp',
    Resultado:      'acordó cita',
    FechaHora:      '2025-01-02T10:00:00.000Z',
    MensajeIAUsado: true,
    TonoUsado:      'empatico',
    Nota:           '[SEED_HIST] Contacto IA tono:empatico',
  }, 'ALL fields combined');
}

main();
