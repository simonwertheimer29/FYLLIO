// app/(public)/privacidad/page.tsx
//
// ⚠️ VERSIÓN PROVISIONAL — NO ES LA POLÍTICA DEFINITIVA (13-09-2026)
//
// Existe por una razón concreta y acotada: Meta exige una URL pública de
// política de privacidad para publicar la app, y sin app publicada no llegan
// mensajes reales al webhook. Es lo que desbloquea la conexión de WhatsApp.
//
// NO la ha revisado un abogado. Lo que dice es verdad —cada afirmación se
// corresponde con lo que hace el código a día de hoy— pero le falta lo que
// solo puede decidir la asesoría jurídica, y son cuatro cosas:
//
//   1. El PLAZO de conservación. Aquí se dice que no está fijado, porque no lo
//      está: `RETENCION_CONVERSACIONES_DIAS` no tiene valor y el cron de
//      caducidad no borra nada. Es honesto, pero el art. 5.1.e exige un plazo.
//   2. La BASE JURÍDICA del tratamiento de datos de salud (art. 9). Aquí se
//      dice que la determina la clínica como responsable, que es correcto, pero
//      el contrato del art. 28 con la clínica todavía no existe.
//   3. La FORMA JURÍDICA y el NIF del responsable. No hay sociedad constituida
//      (alta fiscal pendiente), así que no se inventa ninguna.
//   4. Si la transferencia a Anthropic necesita algo más que su DPA, y si hay
//      que exigir retención cero (ZDR) en la API, que hoy no está activada.
//
// El diagnóstico completo de los cuatro puntos vive en CONSULTA-LEGAL-AGENTE.md.
// La sustitución está anotada como MEJORAS 237, con su condición: esta página
// NO puede seguir viva cuando entre el primer cliente real.
//
// REGLA AL EDITAR: aquí no se escribe nada que el código no cumpla. Si añades
// un compromiso (un plazo, un cifrado, un proveedor menos), primero cámbialo
// en el código. Una política que promete lo que el producto no hace es peor
// que no tenerla.

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Política de privacidad · Fyllio",
  description:
    "Qué datos trata Fyllio, con quién se comparten, cuánto se conservan y cómo ejercer los derechos de acceso y supresión.",
};

const ACTUALIZADA = "13 de septiembre de 2026";
const CONTACTO = "simon.wertheimer29@gmail.com";

function H2({ children, id }: { children: ReactNode; id: string }) {
  return (
    <h2
      id={id}
      className="scroll-mt-[calc(var(--nav-h,72px)+24px)] font-display text-xl font-semibold text-slate-900 sm:text-2xl"
    >
      {children}
    </h2>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="text-base font-semibold text-slate-900">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-slate-700">{children}</p>;
}

function Bloque({ children }: { children: ReactNode }) {
  return <section className="flex flex-col gap-3 border-t border-slate-200 pt-8">{children}</section>;
}

function Lista({ children }: { children: ReactNode }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-slate-700 marker:text-slate-400">
      {children}
    </ul>
  );
}

/** Un tercero que trata datos por cuenta nuestra, con su función real. */
function Encargado({ nombre, para }: { nombre: string; para: string }) {
  return (
    <li>
      <span className="font-semibold text-slate-900">{nombre}</span>
      {" — "}
      {para}
    </li>
  );
}

export default function PrivacidadPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-3 pb-8">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Fyllio</p>
        <h1 className="font-display text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">
          Política de privacidad
        </h1>
        <P>
          Fyllio es un sistema de gestión que usan clínicas dentales para organizar la comunicación con sus
          pacientes, incluidas las conversaciones de WhatsApp. Esta página explica qué datos se tratan, quién
          los procesa, cuánto se conservan y cómo pedir el acceso o el borrado.
        </P>
        <P>
          <span className="font-semibold text-slate-900">Última actualización:</span> {ACTUALIZADA}.
        </P>
      </header>

      <div className="flex flex-col gap-8">
        <Bloque>
          <H2 id="responsable">Quién trata los datos</H2>
          <P>
            Cuando una clínica usa Fyllio, <span className="font-semibold text-slate-900">la clínica es la
            responsable</span> de los datos de sus pacientes: decide qué se trata, para qué y con qué base
            jurídica. Fyllio actúa como <span className="font-semibold text-slate-900">encargado del
            tratamiento</span>, es decir, trata esos datos siguiendo las instrucciones de la clínica y solo
            para prestarle el servicio. Si quieres saber qué clínica tiene tus datos, es aquella con la que
            tienes o has tenido contacto.
          </P>
          <P>
            De los datos que se recogen en esta web, como el correo de un formulario de contacto, Fyllio es el
            responsable.
          </P>
          <P>
            Fyllio es hoy un proyecto en fase inicial y todavía no está constituido como sociedad, por lo que
            esta página no incluye forma jurídica ni número de identificación fiscal. El contacto para
            cualquier asunto de privacidad es{" "}
            <a className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900" href={`mailto:${CONTACTO}`}>
              {CONTACTO}
            </a>
            .
          </P>
        </Bloque>

        <Bloque>
          <H2 id="datos">Qué datos se tratan</H2>
          <H3>Datos de contacto</H3>
          <P>
            El número de teléfono, el nombre que aparece en tu perfil de WhatsApp, y el nombre, el correo y los
            datos que la clínica tenga de ti en su ficha.
          </P>

          <H3>Mensajes de WhatsApp</H3>
          <P>
            El contenido de los mensajes que intercambias con la clínica se guarda tal como se escribe. Eso
            incluye el texto completo, y también las notas de voz, las fotos y los documentos que envíes, junto
            con la fecha y la hora de cada mensaje.
          </P>

          <H3>Datos de tu tratamiento</H3>
          <P>
            El tratamiento por el que preguntas, el importe de un presupuesto, sus fechas y el estado en el que
            está, y las citas que tengas.
          </P>

          <H3>Datos de salud, cuando tú los cuentas</H3>
          <P>
            Fyllio no pide datos de salud y no accede al historial clínico. Pero cuando en un mensaje escribes
            algo sobre tu salud, por ejemplo un dolor, un sangrado, una medicación, un embarazo o un
            antecedente médico, <span className="font-semibold text-slate-900">esa información se guarda
            porque forma parte del mensaje</span>, y también queda registrada en el resumen que el sistema
            automático hace de la conversación. Son datos de categoría especial y se tratan con el mismo
            cuidado que el resto del contenido de la conversación.
          </P>
        </Bloque>

        <Bloque>
          <H2 id="automatico">El sistema automático que redacta las respuestas</H2>
          <P>
            Conviene que lo sepas con claridad:{" "}
            <span className="font-semibold text-slate-900">un sistema automático lee cada mensaje que envías y
            redacta un borrador de respuesta</span>. Ese sistema también resume lo que has pedido, detecta si
            hace falta que alguien te atienda con urgencia y ordena los casos por prioridad.
          </P>
          <P>
            <span className="font-semibold text-slate-900">Ese borrador no se te envía solo.</span> Una persona
            de la clínica lo lee antes, lo cambia si hace falta y decide si se manda. Cuando el sistema no
            puede resolver algo, o cuando detecta que hay que decidir algo que le corresponde a la clínica, lo
            pasa a una persona en vez de contestar.
          </P>
          <P>
            No se toman decisiones automatizadas que te afecten legalmente sin que intervenga una persona.
          </P>
          <P>
            Si en algún momento no quieres recibir más mensajes, dilo en la conversación. El sistema lo
            registra y deja de escribirte, salvo para responder cuando tú escribas.
          </P>
        </Bloque>

        <Bloque>
          <H2 id="terceros">Con quién se comparten</H2>
          <P>
            Tus datos no se venden ni se ceden para publicidad. Se comparten únicamente con los proveedores que
            hacen falta para que el servicio funcione, y cada uno solo recibe lo que necesita para su función.
            Estos son los que se usan hoy:
          </P>
          <Lista>
            <Encargado
              nombre="Meta Platforms"
              para="es el canal. WhatsApp es un servicio de Meta, así que los mensajes pasan por su infraestructura, igual que cualquier conversación de WhatsApp."
            />
            <Encargado
              nombre="Anthropic"
              para="procesa el contenido de las conversaciones. Es el proveedor del modelo Claude, que es el que lee tu mensaje y redacta el borrador. El contenido le llega tal como lo escribiste, sin anonimizar, porque necesita entenderlo para responder con sentido. Bajo los términos comerciales de su interfaz de programación, lo que se le envía no se usa para entrenar sus modelos."
            />
            <Encargado
              nombre="Supabase"
              para="aloja la base de datos donde se guardan los mensajes, las fichas y el resto de la información."
            />
            <Encargado nombre="Vercel" para="aloja y ejecuta la aplicación." />
            <Encargado
              nombre="Upstash"
              para="guarda de forma temporal las tareas pendientes de procesar y los enlaces de los presupuestos que se comparten contigo."
            />
            <Encargado nombre="Twilio" para="envía algunos recordatorios automáticos por WhatsApp." />
            <Encargado
              nombre="OpenAI"
              para="transcribe las notas de voz que graba el personal de la clínica al usar la herramienta. No se le envían mensajes de pacientes."
            />
          </Lista>
          <P>
            Algunos de estos proveedores están fuera del Espacio Económico Europeo o pueden procesar datos en
            servidores de otros países. Cuando eso ocurre, la transferencia se ampara en los mecanismos que
            prevé el reglamento europeo de protección de datos.
          </P>
        </Bloque>

        <Bloque>
          <H2 id="conservacion">Cuánto tiempo se conservan</H2>
          <P>
            Aquí preferimos decir lo que hay:{" "}
            <span className="font-semibold text-slate-900">todavía no hay un plazo de conservación fijado</span>
            . Las conversaciones y los resúmenes que el sistema hace de ellas se conservan mientras la clínica
            mantiene la relación contigo, y se borran cuando tú lo pides o cuando la clínica lo solicita.
          </P>
          <P>
            El plazo definitivo está pendiente de fijarse con asesoramiento legal, y cuando se fije se
            aplicará de forma automática y se actualizará esta página. No damos una cifra antes de tiempo
            porque sería un compromiso que hoy no podríamos cumplir.
          </P>
        </Bloque>

        <Bloque>
          <H2 id="derechos">Tus derechos y cómo ejercerlos</H2>
          <P>
            Puedes pedir acceder a tus datos, rectificarlos, suprimirlos, limitar su tratamiento, oponerte a él
            o solicitar que se te entreguen en un formato portable. Para cualquiera de esas peticiones escribe
            a{" "}
            <a className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900" href={`mailto:${CONTACTO}`}>
              {CONTACTO}
            </a>{" "}
            o dirígete a tu clínica, que es la responsable. Si escribes a Fyllio, la petición se traslada a la
            clínica y se ejecuta con ella.
          </P>

          <H3>Qué pasa exactamente cuando pides el borrado</H3>
          <P>Se borra, para tu número de teléfono:</P>
          <Lista>
            <li>todos los mensajes de la conversación, con su contenido;</li>
            <li>los resúmenes y valoraciones que el sistema automático hizo de esos mensajes;</li>
            <li>los mensajes que estuvieran pendientes de enviarte y los seguimientos programados.</li>
          </Lista>
          <P>
            Se conserva una única anotación de que el borrado se hizo: la fecha, el motivo, quién lo ejecutó y
            cuántos registros se eliminaron, con tu teléfono convertido en un código del que no se puede volver
            atrás. Sirve para poder demostrar que se atendió tu petición, y no contiene ni tu número ni nada de
            lo que escribiste.
          </P>
          <P>
            Dos cosas que conviene saber. El borrado lo ejecuta una persona autorizada cuando recibe tu
            petición, no es automático, así que puede tardar unos días. Y si tu número de teléfono lo compartes
            con otra persona que también es paciente, borrar la conversación de ese número afecta a los
            mensajes de ambas, algo que se te confirmará antes de hacerlo.
          </P>
          <P>
            La ficha que la clínica tenga de ti como paciente, junto con tu historial clínico, se rige por las
            obligaciones de conservación que la ley impone a los centros sanitarios, y eso lo gestiona la
            clínica.
          </P>
          <P>
            Si no estás conforme con cómo se han tratado tus datos, puedes presentar una reclamación ante la
            Agencia Española de Protección de Datos.
          </P>
        </Bloque>

        <Bloque>
          <H2 id="seguridad">Seguridad</H2>
          <P>
            El acceso a los datos está limitado por clínica: quien trabaja en un centro solo ve los pacientes
            de los centros que le corresponden. Las comunicaciones van cifradas en tránsito y los mensajes que
            llegan por WhatsApp se verifican criptográficamente para comprobar que vienen de Meta y no de un
            tercero.
          </P>
        </Bloque>

        <Bloque>
          <H2 id="cambios">Cambios en esta política</H2>
          <P>
            Esta es la primera versión, publicada el {ACTUALIZADA}. Se actualizará cuando cambien los
            proveedores, cuando se fije el plazo de conservación o cuando cambie la forma en que el sistema
            automático trata los mensajes. La fecha de arriba indica siempre la versión vigente.
          </P>
        </Bloque>
      </div>
    </main>
  );
}
