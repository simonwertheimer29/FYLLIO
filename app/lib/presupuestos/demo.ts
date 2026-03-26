// app/lib/presupuestos/demo.ts
// ~90 presupuestos · 5 doctores · 2 clínicas · 12 meses · 6 estados

import type { Presupuesto, Contacto, Doctor } from "./types";
import type { PresupuestoEstado, EspecialidadDoctor, TipoPaciente, TipoVisita } from "./types";
import { computeUrgencyScore } from "./urgency";

export const DEMO_DOCTORES: Doctor[] = [
  { id: "dr1", nombre: "Dr. García",    especialidad: "General",        clinica: "Clínica Madrid Centro", activo: true },
  { id: "dr2", nombre: "Dr. Martínez",  especialidad: "Implantólogo",   clinica: "Clínica Madrid Centro", activo: true },
  { id: "dr3", nombre: "Dra. Romero",   especialidad: "Ortodoncia",     clinica: "Clínica Madrid Centro", activo: true },
  { id: "dr4", nombre: "Dr. Sánchez",   especialidad: "Prostodoncista", clinica: "Clínica Salamanca",     activo: true },
  { id: "dr5", nombre: "Dra. López",    especialidad: "Endodoncista",   clinica: "Clínica Salamanca",     activo: true },
];

const _today = new Date();

function daysAgo(n: number): string {
  const d = new Date(_today);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Date = monthsBack months ago + dayOffset days within that month
function mDate(monthsBack: number, dayOffset = 0): string {
  const d = new Date(_today);
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsBack);
  d.setDate(Math.min(28, 1 + dayOffset));
  return d.toISOString().slice(0, 10);
}

type RawP = Omit<Presupuesto, "urgencyScore">;

function mk(
  id: string,
  name: string,
  phone: string | undefined,
  treatments: string[],
  doctor: string,
  esp: EspecialidadDoctor,
  tipo: TipoPaciente,
  visita: TipoVisita,
  amount: number,
  estado: PresupuestoEstado,
  fecha: string,
  clinica: "Clínica Madrid Centro" | "Clínica Salamanca",
  notes?: string,
  lastContactDate?: string,
  contactCount = 0,
): RawP {
  const t0 = _today.toISOString().slice(0, 10);
  const ds = Math.max(0, Math.round((new Date(t0).getTime() - new Date(fecha).getTime()) / 86400000));
  const lcda = lastContactDate
    ? Math.max(0, Math.round((new Date(t0).getTime() - new Date(lastContactDate).getTime()) / 86400000))
    : undefined;
  return {
    id, patientName: name, patientPhone: phone,
    treatments, doctor, doctorEspecialidad: esp,
    tipoPaciente: tipo, tipoVisita: visita,
    amount, estado, fechaPresupuesto: fecha,
    fechaAlta: fecha, daysSince: ds, clinica, notes,
    lastContactDate, lastContactDaysAgo: lcda, contactCount,
    createdBy: "ventas@demo.com",
  };
}

const raw: RawP[] = [
  // ── MES ACTUAL (activos y recientes) ─────────────────────────────────
  mk("m0_1","Ana Belén Ruiz",     "+34611200001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4200, "INTERESADO",    daysAgo(3),  "Clínica Madrid Centro", "Muy interesada, pide cita", daysAgo(1), 1),
  mk("m0_2","Javier Mora Pinto",  "+34611200002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "PRESENTADO",    daysAgo(1),  "Clínica Madrid Centro"),
  mk("m0_3","Elena Vargas",       "+34611200003", ["Limpieza dental","Revisión"],    "Dr. García",   "General",        "Adeslas",  "Paciente con Historia",  180, "EN_DUDA",       daysAgo(5),  "Clínica Madrid Centro", "Duda sobre cobertura Adeslas", daysAgo(2), 2),
  mk("m0_4","Tomás Ibáñez",       "+34611200004", ["Endodoncia molar"],              "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  750, "INTERESADO",    daysAgo(4),  "Clínica Salamanca", undefined, daysAgo(2), 1),
  mk("m0_5","Patricia Fuentes",   "+34611200005", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3200, "EN_NEGOCIACION",daysAgo(8),  "Clínica Madrid Centro", "Pide 10% descuento", daysAgo(3), 3),
  mk("m0_6","Carlos Méndez",      "+34611200006", ["Prótesis dental superior"],      "Dr. Sánchez",  "Prostodoncista", "Privado",  "Primera Visita",        4500, "PRESENTADO",    daysAgo(2),  "Clínica Salamanca"),
  mk("m0_7","Lucía Castillo",     "+34611200007", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Privado",  "Paciente con Historia",  480, "INTERESADO",    daysAgo(6),  "Clínica Madrid Centro", undefined, daysAgo(4), 1),
  mk("m0_8","Marcos Herrera",     "+34611200008", ["Implante dental","Corona cerámica"],"Dr. Martínez","Implantólogo",  "Privado",  "Primera Visita",        3600, "ACEPTADO",      daysAgo(10), "Clínica Madrid Centro", undefined, undefined, 2),

  // ── MES -1 ────────────────────────────────────────────────────────────
  mk("m1_1","Rosa Delgado",       "+34611300001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4500, "ACEPTADO",      mDate(1,2),  "Clínica Madrid Centro"),
  mk("m1_2","Fernando Nieto",     "+34611300002", ["Endodoncia bicúspide"],          "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  650, "ACEPTADO",      mDate(1,5),  "Clínica Salamanca"),
  mk("m1_3","Carmen Vidal",       "+34611300003", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3000, "PERDIDO",       mDate(1,3),  "Clínica Madrid Centro", "Se fue con otra clínica"),
  mk("m1_4","Rodrigo Soto",       "+34611300004", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "EN_DUDA",       mDate(1,8),  "Clínica Madrid Centro", "Esperando segunda opinión", mDate(1,15), 2),
  mk("m1_5","Isabel Ponce",       "+34611300005", ["Prótesis parcial"],              "Dr. Sánchez",  "Prostodoncista", "Privado",  "Paciente con Historia", 3200, "ACEPTADO",      mDate(1,10), "Clínica Salamanca"),
  mk("m1_6","Diego Morales",      "+34611300006", ["Revisión ortodoncia"],           "Dra. Romero",  "Ortodoncia",     "Adeslas",  "Paciente con Historia",  120, "PERDIDO",       mDate(1,6),  "Clínica Madrid Centro"),
  mk("m1_7","Nuria Campos",       "+34611300007", ["Implante dental","Corona cerámica"],"Dr. Martínez","Implantólogo",  "Privado",  "Primera Visita",        3800, "EN_NEGOCIACION",mDate(1,12), "Clínica Madrid Centro", "Pide financiación", mDate(1,20), 3),
  mk("m1_8","Alfonso Durán",      "+34611300008", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Adeslas",  "Paciente con Historia",  200, "ACEPTADO",      mDate(1,15), "Clínica Salamanca"),

  // ── MES -2 ────────────────────────────────────────────────────────────
  mk("m2_1","Silvia Rubio",       "+34611400001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4200, "ACEPTADO",      mDate(2,3),  "Clínica Madrid Centro"),
  mk("m2_2","Pedro Iglesias",     "+34611400002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "ACEPTADO",      mDate(2,7),  "Clínica Madrid Centro"),
  mk("m2_3","Beatriz Lara",       "+34611400003", ["Endodoncia molar"],              "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  700, "PERDIDO",       mDate(2,5),  "Clínica Salamanca", "No contestó"),
  mk("m2_4","Víctor Ramírez",     "+34611400004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3200, "ACEPTADO",      mDate(2,9),  "Clínica Madrid Centro"),
  mk("m2_5","Consuelo Peña",      "+34611400005", ["Prótesis dental superior"],      "Dr. Sánchez",  "Prostodoncista", "Privado",  "Primera Visita",        4800, "PERDIDO",       mDate(2,4),  "Clínica Salamanca", "Precio demasiado alto"),
  mk("m2_6","Arturo Blanco",      "+34611400006", ["Revisión ortodoncia"],           "Dra. Romero",  "Ortodoncia",     "Adeslas",  "Paciente con Historia",  150, "ACEPTADO",      mDate(2,12), "Clínica Madrid Centro"),
  mk("m2_7","Mireya Santos",      "+34611400007", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Privado",  "Paciente con Historia",  680, "PERDIDO",       mDate(2,6),  "Clínica Salamanca"),
  mk("m2_8","Gonzalo Serrano",    "+34611400008", ["Implante dental","Corona cerámica"],"Dr. Martínez","Implantólogo",  "Adeslas",  "Primera Visita",        3200, "ACEPTADO",      mDate(2,14), "Clínica Madrid Centro"),

  // ── MES -3 ────────────────────────────────────────────────────────────
  mk("m3_1","Amparo Jiménez",     "+34611500001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4500, "ACEPTADO",      mDate(3,2),  "Clínica Madrid Centro"),
  mk("m3_2","Roberto Cano",       "+34611500002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "PERDIDO",       mDate(3,5),  "Clínica Madrid Centro", "Sin respuesta"),
  mk("m3_3","Inés Molina",        "+34611500003", ["Endodoncia bicúspide"],          "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  650, "ACEPTADO",      mDate(3,8),  "Clínica Salamanca"),
  mk("m3_4","Joaquín Reyes",      "+34611500004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        2800, "ACEPTADO",      mDate(3,3),  "Clínica Madrid Centro"),
  mk("m3_5","Cristina Aguilar",   "+34611500005", ["Prótesis parcial"],              "Dr. Sánchez",  "Prostodoncista", "Privado",  "Paciente con Historia", 3500, "PERDIDO",       mDate(3,10), "Clínica Salamanca"),
  mk("m3_6","Sergio Navarro",     "+34611500006", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Adeslas",  "Paciente con Historia",  250, "ACEPTADO",      mDate(3,7),  "Clínica Salamanca"),
  mk("m3_7","Laura Cabrera",      "+34611500007", ["Implante dental","Corona cerámica"],"Dr. Martínez","Implantólogo",  "Privado",  "Primera Visita",        3800, "ACEPTADO",      mDate(3,12), "Clínica Madrid Centro"),
  mk("m3_8","Miguel Ángel Haro",  "+34611500008", ["Revisión ortodoncia"],           "Dra. Romero",  "Ortodoncia",     "Adeslas",  "Paciente con Historia",  180, "PERDIDO",       mDate(3,9),  "Clínica Madrid Centro"),

  // ── MES -4 ────────────────────────────────────────────────────────────
  mk("m4_1","Pilar Estévez",      "+34611600001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4200, "ACEPTADO",      mDate(4,4),  "Clínica Madrid Centro"),
  mk("m4_2","Luis Miguel Torres", "+34611600002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "ACEPTADO",      mDate(4,6),  "Clínica Madrid Centro"),
  mk("m4_3","Esther Domínguez",   "+34611600003", ["Endodoncia molar"],              "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  800, "PERDIDO",       mDate(4,3),  "Clínica Salamanca"),
  mk("m4_4","Francisco Ortega",   "+34611600004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3000, "ACEPTADO",      mDate(4,9),  "Clínica Madrid Centro"),
  mk("m4_5","Dolores Medina",     "+34611600005", ["Prótesis dental superior"],      "Dr. Sánchez",  "Prostodoncista", "Adeslas",  "Primera Visita",        4200, "ACEPTADO",      mDate(4,5),  "Clínica Salamanca"),
  mk("m4_6","Andrés Guerrero",    "+34611600006", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Privado",  "Paciente con Historia",  480, "PERDIDO",       mDate(4,11), "Clínica Madrid Centro"),
  mk("m4_7","Yolanda Pascual",    "+34611600007", ["Implante dental","Cirugía guiada"],"Dr. Martínez","Implantólogo",   "Privado",  "Primera Visita",        4500, "ACEPTADO",      mDate(4,8),  "Clínica Madrid Centro"),

  // ── MES -5 ────────────────────────────────────────────────────────────
  mk("m5_1","Manuel Ramos",       "+34611700001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4500, "ACEPTADO",      mDate(5,2),  "Clínica Madrid Centro"),
  mk("m5_2","Claudia Vega",       "+34611700002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "PERDIDO",       mDate(5,7),  "Clínica Madrid Centro"),
  mk("m5_3","Raúl Hidalgo",       "+34611700003", ["Endodoncia bicúspide"],          "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  600, "ACEPTADO",      mDate(5,4),  "Clínica Salamanca"),
  mk("m5_4","Gloria Ferrer",      "+34611700004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3200, "ACEPTADO",      mDate(5,9),  "Clínica Madrid Centro"),
  mk("m5_5","Santiago Montes",    "+34611700005", ["Prótesis parcial"],              "Dr. Sánchez",  "Prostodoncista", "Privado",  "Primera Visita",        3600, "PERDIDO",       mDate(5,5),  "Clínica Salamanca"),
  mk("m5_6","Miriam Gallego",     "+34611700006", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Adeslas",  "Paciente con Historia",  250, "ACEPTADO",      mDate(5,12), "Clínica Salamanca"),
  mk("m5_7","Álvaro Pereira",     "+34611700007", ["Implante dental","Corona cerámica"],"Dr. Martínez","Implantólogo",  "Privado",  "Primera Visita",        3800, "ACEPTADO",      mDate(5,6),  "Clínica Madrid Centro"),
  mk("m5_8","Natalia Ibarra",     "+34611700008", ["Revisión ortodoncia"],           "Dra. Romero",  "Ortodoncia",     "Adeslas",  "Paciente con Historia",  150, "PERDIDO",       mDate(5,10), "Clínica Madrid Centro"),

  // ── MES -6 ────────────────────────────────────────────────────────────
  mk("m6_1","Remedios Gil",       "+34611800001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4200, "ACEPTADO",      mDate(6,3),  "Clínica Madrid Centro"),
  mk("m6_2","Jorge Crespo",       "+34611800002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "ACEPTADO",      mDate(6,6),  "Clínica Madrid Centro"),
  mk("m6_3","Marina Vázquez",     "+34611800003", ["Endodoncia molar"],              "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  700, "ACEPTADO",      mDate(6,4),  "Clínica Salamanca"),
  mk("m6_4","Héctor Bravo",       "+34611800004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3000, "PERDIDO",       mDate(6,8),  "Clínica Madrid Centro"),
  mk("m6_5","Paloma Romero",      "+34611800005", ["Prótesis dental superior"],      "Dr. Sánchez",  "Prostodoncista", "Privado",  "Primera Visita",        4800, "ACEPTADO",      mDate(6,2),  "Clínica Salamanca"),
  mk("m6_6","Ernesto Suárez",     "+34611800006", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Privado",  "Paciente con Historia",  480, "PERDIDO",       mDate(6,11), "Clínica Madrid Centro"),
  mk("m6_7","Sofía Castro",       "+34611800007", ["Implante dental","Corona cerámica"],"Dr. Martínez","Implantólogo",  "Privado",  "Primera Visita",        3600, "ACEPTADO",      mDate(6,9),  "Clínica Madrid Centro"),

  // ── MES -7 ────────────────────────────────────────────────────────────
  mk("m7_1","Teresa Marín",       "+34611900001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4500, "ACEPTADO",      mDate(7,4),  "Clínica Madrid Centro"),
  mk("m7_2","Ignacio Flores",     "+34611900002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "PERDIDO",       mDate(7,7),  "Clínica Madrid Centro"),
  mk("m7_3","Eva Santana",        "+34611900003", ["Endodoncia bicúspide"],          "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  600, "ACEPTADO",      mDate(7,3),  "Clínica Salamanca"),
  mk("m7_4","Óscar Mendoza",      "+34611900004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3200, "ACEPTADO",      mDate(7,9),  "Clínica Madrid Centro"),
  mk("m7_5","Verónica Aranda",    "+34611900005", ["Prótesis parcial"],              "Dr. Sánchez",  "Prostodoncista", "Adeslas",  "Paciente con Historia", 3000, "PERDIDO",       mDate(7,5),  "Clínica Salamanca"),
  mk("m7_6","Rafael Espinosa",    "+34611900006", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Privado",  "Paciente con Historia",  480, "ACEPTADO",      mDate(7,12), "Clínica Salamanca"),
  mk("m7_7","Mónica Calvo",       "+34611900007", ["Implante dental","Corona cerámica"],"Dr. Martínez","Implantólogo",  "Privado",  "Primera Visita",        3800, "ACEPTADO",      mDate(7,6),  "Clínica Madrid Centro"),

  // ── MES -8 ────────────────────────────────────────────────────────────
  mk("m8_1","Susana Navarro",     "+34612000001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4200, "ACEPTADO",      mDate(8,2),  "Clínica Madrid Centro"),
  mk("m8_2","David León",         "+34612000002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "ACEPTADO",      mDate(8,5),  "Clínica Madrid Centro"),
  mk("m8_3","Cecilia Moreno",     "+34612000003", ["Endodoncia molar"],              "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  750, "PERDIDO",       mDate(8,8),  "Clínica Salamanca"),
  mk("m8_4","Germán Ríos",        "+34612000004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3000, "PERDIDO",       mDate(8,3),  "Clínica Madrid Centro"),
  mk("m8_5","Lourdes Cruz",       "+34612000005", ["Prótesis dental superior"],      "Dr. Sánchez",  "Prostodoncista", "Privado",  "Primera Visita",        4500, "ACEPTADO",      mDate(8,10), "Clínica Salamanca"),
  mk("m8_6","Tomás Padilla",      "+34612000006", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Adeslas",  "Paciente con Historia",  250, "ACEPTADO",      mDate(8,7),  "Clínica Madrid Centro"),
  mk("m8_7","Esperanza Fuentes",  "+34612000007", ["Implante dental","Cirugía guiada"],"Dr. Martínez","Implantólogo",  "Privado",  "Primera Visita",        4500, "ACEPTADO",      mDate(8,13), "Clínica Madrid Centro"),

  // ── MES -9 ────────────────────────────────────────────────────────────
  mk("m9_1","Adriana Parra",      "+34612100001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4500, "ACEPTADO",      mDate(9,3),  "Clínica Madrid Centro"),
  mk("m9_2","Emilio Varela",      "+34612100002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "ACEPTADO",      mDate(9,6),  "Clínica Madrid Centro"),
  mk("m9_3","Hortensia Moya",     "+34612100003", ["Endodoncia bicúspide"],          "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  650, "ACEPTADO",      mDate(9,4),  "Clínica Salamanca"),
  mk("m9_4","Lorenzo Pinto",      "+34612100004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3200, "PERDIDO",       mDate(9,8),  "Clínica Madrid Centro"),
  mk("m9_5","Macarena Guzmán",    "+34612100005", ["Prótesis parcial"],              "Dr. Sánchez",  "Prostodoncista", "Privado",  "Primera Visita",        3600, "ACEPTADO",      mDate(9,5),  "Clínica Salamanca"),
  mk("m9_6","Rubén Alonso",       "+34612100006", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Privado",  "Paciente con Historia",  480, "PERDIDO",       mDate(9,11), "Clínica Salamanca"),

  // ── MES -10 ───────────────────────────────────────────────────────────
  mk("m10_1","Encarnación Díaz",  "+34612200001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4200, "ACEPTADO",      mDate(10,4), "Clínica Madrid Centro"),
  mk("m10_2","Aurelio Valls",     "+34612200002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "PERDIDO",       mDate(10,7), "Clínica Madrid Centro"),
  mk("m10_3","Montserrat Gil",    "+34612200003", ["Endodoncia molar"],              "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  700, "ACEPTADO",      mDate(10,3), "Clínica Salamanca"),
  mk("m10_4","Esteban Castro",    "+34612200004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3000, "ACEPTADO",      mDate(10,9), "Clínica Madrid Centro"),
  mk("m10_5","Nieves Cortés",     "+34612200005", ["Prótesis dental superior"],      "Dr. Sánchez",  "Prostodoncista", "Privado",  "Primera Visita",        4800, "ACEPTADO",      mDate(10,5), "Clínica Salamanca"),
  mk("m10_6","Damián Ureña",      "+34612200006", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Adeslas",  "Paciente con Historia",  250, "PERDIDO",       mDate(10,12),"Clínica Madrid Centro"),

  // ── MES -11 ───────────────────────────────────────────────────────────
  mk("m11_1","Virtudes Salas",    "+34612300001", ["Ortodoncia invisible"],          "Dra. Romero",  "Ortodoncia",     "Privado",  "Primera Visita",        4500, "ACEPTADO",      mDate(11,2), "Clínica Madrid Centro"),
  mk("m11_2","Primitivo Lozano",  "+34612300002", ["Implante dental"],               "Dr. Martínez", "Implantólogo",   "Privado",  "Primera Visita",        2800, "ACEPTADO",      mDate(11,6), "Clínica Madrid Centro"),
  mk("m11_3","Adoración Vera",    "+34612300003", ["Endodoncia bicúspide"],          "Dra. López",   "Endodoncista",   "Adeslas",  "Paciente con Historia",  650, "PERDIDO",       mDate(11,4), "Clínica Salamanca"),
  mk("m11_4","Celestino Muñoz",   "+34612300004", ["Carillas de porcelana"],         "Dr. García",   "General",        "Privado",  "Primera Visita",        3200, "ACEPTADO",      mDate(11,8), "Clínica Madrid Centro"),
  mk("m11_5","Soledad Prieto",    "+34612300005", ["Prótesis parcial"],              "Dr. Sánchez",  "Prostodoncista", "Privado",  "Primera Visita",        3500, "ACEPTADO",      mDate(11,5), "Clínica Salamanca"),
  mk("m11_6","Wenceslao Mora",    "+34612300006", ["Blanqueamiento dental"],         "Dr. García",   "General",        "Privado",  "Paciente con Historia",  480, "PERDIDO",       mDate(11,10),"Clínica Madrid Centro"),
];

export const DEMO_PRESUPUESTOS: Presupuesto[] = raw.map((p) => ({
  ...p,
  urgencyScore: computeUrgencyScore({ ...p, urgencyScore: 0 }),
}));

export const DEMO_CONTACTOS: Contacto[] = [
  { id: "c1",  presupuestoId: "m0_1", tipo: "llamada",  resultado: "contestó",     fechaHora: `${daysAgo(3)}T09:30:00`, nota: "Muy interesada, pide cita", registradoPor: "ventas@demo.com" },
  { id: "c2",  presupuestoId: "m0_1", tipo: "whatsapp", resultado: "contestó",     fechaHora: `${daysAgo(1)}T11:00:00`, nota: "Confirmada cita semana próxima", registradoPor: "ventas@demo.com" },
  { id: "c3",  presupuestoId: "m0_3", tipo: "llamada",  resultado: "pidió tiempo", fechaHora: `${daysAgo(5)}T10:00:00`, nota: "Duda sobre cobertura Adeslas", registradoPor: "ventas@demo.com" },
  { id: "c4",  presupuestoId: "m0_3", tipo: "whatsapp", resultado: "contestó",     fechaHora: `${daysAgo(2)}T10:30:00`, nota: "Enviamos información de cobertura", registradoPor: "ventas@demo.com" },
  { id: "c5",  presupuestoId: "m0_4", tipo: "llamada",  resultado: "acordó cita",  fechaHora: `${daysAgo(2)}T09:00:00`, nota: "Cita para el jueves", registradoPor: "ventas@demo.com" },
  { id: "c6",  presupuestoId: "m0_5", tipo: "visita",   resultado: "pidió tiempo", fechaHora: `${daysAgo(8)}T11:00:00`, nota: "Vino a visita, pide 10% descuento", registradoPor: "ventas@demo.com" },
  { id: "c7",  presupuestoId: "m0_5", tipo: "email",    resultado: "contestó",     fechaHora: `${daysAgo(6)}T09:00:00`, nota: "Enviamos opciones de financiación", registradoPor: "ventas@demo.com" },
  { id: "c8",  presupuestoId: "m0_5", tipo: "llamada",  resultado: "pidió tiempo", fechaHora: `${daysAgo(3)}T16:00:00`, nota: "Sigue valorando", registradoPor: "ventas@demo.com" },
  { id: "c9",  presupuestoId: "m0_7", tipo: "llamada",  resultado: "contestó",     fechaHora: `${daysAgo(4)}T10:00:00`, nota: "Interesado en el blanqueamiento", registradoPor: "ventas@demo.com" },
];
