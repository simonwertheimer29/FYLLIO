// scripts/demo-conocimiento.mjs — LO PUBLICADO por cada clínica DEMO (12-09).
//
// UNA sola definición (§18: generado y a mano no conviven): la lee
// db-seed-demo-rico.mjs en `demo:reset` y db-seed-conocimiento.mts en
// `demo:conocimiento` (solo esta columna, validada con el parser real).
//
// Datos INVENTADOS para la demo — jamás evidencia de mercado (MERCADO.md).
// Cada sede publica cosas DISTINTAS a propósito, para que los guiones jugados
// midan al agente con lo que consta y con lo que no:
//   Este   · abre sábados, parking público cerca, seguros; la sedación NO está
//            publicada (Nuria: debe remitir, no inventar ni negar).
//   Norte  · implante CON precio publicado y financiación; sin seguros (Carlos).
//   Centro · ortodoncia invisible con cuota y primera visita sin coste (Dani).
//   Sur    · revisión con precio, zona azul, seguros (Carmen / Lucía).
// Topes del parser: presentación ≤ 400, política ≤ 800, ubicación ≤ 300,
// precios entre 1 y 100.000 € (motivoPrecioAbsurdo), horas HH:MM.

const dia = (inicio, fin) => ({ activo: true, inicio, fin });
const cerrado = { activo: false, inicio: "10:00", fin: "14:00" };
const semana = (inicio, fin, extra = {}) => ({
  lunes: dia(inicio, fin), martes: dia(inicio, fin), miercoles: dia(inicio, fin), jueves: dia(inicio, fin),
  viernes: dia(inicio, fin), sabado: cerrado, domingo: cerrado, ...extra,
});
const sinAlcance = { umbralInsistencia: null, urgencias: null, urgenciaDefinicionExtra: null };

export const CONOCIMIENTO_DEMO = {
  "Clínica Demo Este": {
    quienesSois: { presentacion: "Clínica familiar en el barrio de Salamanca, 18 años cuidando las bocas del barrio, con la Dra. Ana Gil al frente.", trato: null },
    tratamientos: [
      { nombre: "Primera visita y valoración", precio: "sin coste", nota: "incluye radiografía panorámica" },
      { nombre: "Higiene bucodental (limpieza)", precio: "55 €", nota: null },
      { nombre: "Extracción", precio: "desde 60 €", nota: "muelas del juicio: se valora en consulta" },
      { nombre: "Implante unitario", precio: null, nota: "presupuesto tras la valoración" },
      { nombre: "Ortodoncia invisible", precio: "desde 35 €/mes", nota: "financiación hasta 36 meses sin intereses" },
    ],
    politicas: [
      { titulo: "Vías de pago", texto: "Efectivo, tarjeta y transferencia." },
      { titulo: "Seguros", texto: "Trabajamos con Sanitas y Adeslas (cuadro médico). Con el resto de seguros, por reembolso." },
      { titulo: "Cancelaciones", texto: "Cambiar o anular una cita hasta 24 h antes, sin coste." },
    ],
    enlaces: [{ etiqueta: "Web", url: "https://clinica-demo-este.example" }],
    ubicacion: {
      direccion: "C/ Alcalá 120, 28009 Madrid",
      comoLlegar: "Metro Goya (L2, L4) · bus 21 y 53",
      parking: "Parking público en Felipe II, a 3 minutos andando; no tenemos parking propio.",
    },
    agendaNivel: 1,
    alcance: sinAlcance,
    plazos: { horario: semana("09:30", "20:00", { sabado: dia("10:00", "14:00") }) },
  },
  "Clínica Demo Norte": {
    quienesSois: { presentacion: "Implantología y estética dental en Chamartín desde 2009. Equipo de cuatro doctores y laboratorio propio.", trato: null },
    tratamientos: [
      { nombre: "Primera visita y valoración", precio: "sin coste", nota: null },
      { nombre: "Implante unitario", precio: "desde 1.100 €", nota: "implante + corona; el precio final depende del hueso y se cierra en la valoración" },
      { nombre: "Corona", precio: "desde 450 €", nota: null },
      { nombre: "Higiene bucodental (limpieza)", precio: "60 €", nota: null },
      { nombre: "Blanqueamiento", precio: "290 €", nota: "en clínica, una sesión" },
    ],
    politicas: [
      { titulo: "Vías de pago", texto: "Efectivo, tarjeta y transferencia." },
      { titulo: "Financiación", texto: "Hasta 24 meses sin intereses, sujeta a aprobación de la financiera." },
    ],
    enlaces: [],
    ubicacion: {
      direccion: "Avda. de Alberto Alcocer 24, 28036 Madrid",
      comoLlegar: "Metro Cuzco (L10) · bus 27 y 150",
      parking: "Parking propio gratuito para pacientes, entrada por la calle Doctor Fleming.",
    },
    agendaNivel: 1,
    alcance: sinAlcance,
    plazos: { horario: semana("09:00", "21:00") },
  },
  "Clínica Demo Centro": {
    quienesSois: { presentacion: "En pleno centro de Madrid, especialistas en ortodoncia invisible para adultos.", trato: null },
    tratamientos: [
      { nombre: "Primera visita y valoración", precio: "sin coste", nota: "estudio de ortodoncia incluido" },
      { nombre: "Ortodoncia invisible", precio: "desde 45 €/mes", nota: "hasta 36 meses; el plan exacto sale del estudio" },
      { nombre: "Brackets", precio: "desde 1.900 €", nota: null },
      { nombre: "Higiene bucodental (limpieza)", precio: "49 €", nota: null },
    ],
    politicas: [
      { titulo: "Vías de pago", texto: "Tarjeta, transferencia y Bizum." },
      { titulo: "Financiación", texto: "Hasta 36 meses sin intereses, sujeta a aprobación." },
      { titulo: "Cancelaciones", texto: "Cambiar o anular una cita hasta 24 h antes, sin coste." },
    ],
    enlaces: [{ etiqueta: "Reserva online", url: "https://clinica-demo-centro.example/reserva" }],
    ubicacion: {
      direccion: "Gran Vía 38, 3º, 28013 Madrid",
      comoLlegar: "Metro Callao (L3, L5) y Gran Vía (L1, L5)",
      parking: "No tenemos parking; el más cercano es el público de Plaza de los Mostenses.",
    },
    agendaNivel: 1,
    alcance: sinAlcance,
    plazos: { horario: semana("09:00", "20:00", { viernes: dia("09:00", "15:00") }) },
  },
  "Clínica Demo Sur": {
    quienesSois: { presentacion: "Clínica de barrio en Usera, atención a toda la familia desde 2004.", trato: null },
    tratamientos: [
      { nombre: "Primera visita y valoración", precio: "sin coste", nota: null },
      { nombre: "Revisión y limpieza", precio: "49 €", nota: "incluye revisión y radiografías" },
      { nombre: "Empaste", precio: "desde 55 €", nota: null },
      { nombre: "Endodoncia", precio: "desde 190 €", nota: null },
      { nombre: "Extracción", precio: "desde 50 €", nota: null },
    ],
    politicas: [
      { titulo: "Vías de pago", texto: "Efectivo, tarjeta y Bizum." },
      { titulo: "Seguros", texto: "Trabajamos con DKV, Mapfre y Asisa." },
      { titulo: "Cancelaciones", texto: "Avisar con 24 h; una cita perdida sin avisar se cobra 20 €." },
    ],
    enlaces: [],
    ubicacion: {
      direccion: "C/ Marcelo Usera 45, 28026 Madrid",
      comoLlegar: "Metro Usera (L6) · bus 6 y 78",
      parking: "Zona azul en la calle; parking público en Plaza Elíptica, a 10 minutos.",
    },
    agendaNivel: 1,
    alcance: sinAlcance,
    plazos: { horario: semana("10:00", "20:00") },
  },
};
