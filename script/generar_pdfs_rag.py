# -*- coding: utf-8 -*-
"""
Generador de 4 PDFs de prueba para RAG.
Incluye: tablas, gráficos, contenido bilingüe (ES/EN),
párrafos ruido, metadatos, y ground_truth.json para evaluación.

Uso:
    python generar_pdfs_rag.py

Salida:
    ./pdfs_rag/*.pdf
    ./pdfs_rag/*.tex          (versión LaTeX de cada doc)
    ./pdfs_rag/ground_truth.json
"""
import os, json, io, random
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, ListFlowable, ListItem, Image
)
from faker import Faker
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

fake = Faker("es_ES")
Faker.seed(42)
random.seed(42)

OUT_DIR = "pdfs_rag"
os.makedirs(OUT_DIR, exist_ok=True)

# ---------- Estilos ----------
styles = getSampleStyleSheet()
H1   = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=18, spaceAfter=10)
H2   = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13, spaceAfter=6)
H3   = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=11, spaceAfter=4)
BODY = ParagraphStyle("BODY", parent=styles["BodyText"], fontSize=10, leading=14)
EN   = ParagraphStyle("EN", parent=BODY, textColor=colors.HexColor("#444444"), fontSize=9.5)
SMALL= ParagraphStyle("SMALL", parent=styles["BodyText"], fontSize=8, textColor=colors.grey)

# ---------- Helpers ----------
def tabla_datos(headers, rows, col_widths=None, fs=8.5):
    data = [headers] + rows
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1f4e79")),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), fs),
        ("GRID", (0,0), (-1,-1), 0.4, colors.grey),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#eef3f8")]),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 5),
        ("RIGHTPADDING", (0,0), (-1,-1), 5),
    ]))
    return t

def lista(items, bullet="•"):
    return ListFlowable(
        [ListItem(Paragraph(i, BODY), leftIndent=12) for i in items],
        bulletType="bullet", start=bullet, leftIndent=15)

def img_from_matplotlib(fig, width=6.2*inch):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return Image(buf, width=width, height=width*0.55)

def encabezado_pie(canvas, doc, titulo):
    canvas.saveState()
    canvas.setFont("Helvetica-Bold", 9)
    canvas.setFillColor(colors.HexColor("#1f4e79"))
    canvas.drawString(0.7*inch, LETTER[1]-0.5*inch, titulo)
    canvas.setStrokeColor(colors.HexColor("#1f4e79"))
    canvas.line(0.7*inch, LETTER[1]-0.55*inch, LETTER[0]-0.7*inch, LETTER[1]-0.55*inch)
    canvas.setFont("Helvetica", 8); canvas.setFillColor(colors.grey)
    canvas.drawString(0.7*inch, 0.4*inch, "Documento sintético de prueba para RAG — Synthetic test document for RAG")
    canvas.drawRightString(LETTER[0]-0.7*inch, 0.4*inch, f"Página {doc.page}")
    canvas.restoreState()

def build_pdf(filename, titulo, story_builder):
    path = os.path.join(OUT_DIR, filename)
    doc = SimpleDocTemplate(
        path, pagesize=LETTER,
        leftMargin=0.7*inch, rightMargin=0.7*inch,
        topMargin=0.9*inch, bottomMargin=0.7*inch,
        title=titulo, author="Equipo RAG QA",
        subject="Documento de prueba para recuperación aumentada",
        keywords="rag, prueba, sintético, tablas, chunking, bilingual, matplotlib",
    )
    story = [Paragraph(titulo, H1),
             Paragraph(f"<i>Generado el {fake.date()} — contenido sintético ES/EN.</i>", SMALL),
             Spacer(1, 10)]
    story_builder(story)
    doc.build(story,
              onFirstPage=lambda c,d: encabezado_pie(c,d,titulo),
              onLaterPages=lambda c,d: encabezado_pie(c,d,titulo))
    print(f"✅ {path}")

# ==========================================================
# DOC 1 — RR.HH.
# ==========================================================
def doc1(story):
    story.append(Paragraph("1. Políticas de Recursos Humanos — HR Policies", H2))
    story.append(Paragraph(
        "Manual interno de <b>Acme Corp S.A.</b> aplicable a todos los colaboradores. "
        "Vigente desde el 1 de enero, revisado anualmente por el comité de dirección.", BODY))
    story.append(Paragraph(
        "<i>Internal handbook for Acme Corp S.A. applicable to all employees. "
        "Effective January 1st, reviewed annually by the executive committee.</i>", EN))
    story.append(Spacer(1, 8))

    story.append(Paragraph("1.1 Beneficios por antigüedad — Benefits by seniority", H2))
    años = [1, 2, 3, 5, 8, 10]
    rows = [[str(a), fake.job(), f"{15+a} días", f"${800+a*150:,}", "Sí" if a>3 else "No"] for a in años]
    story.append(tabla_datos(
        ["Año", "Puesto tipo", "Vacaciones", "Bono anual", "Seguro dental"],
        rows, col_widths=[0.7*inch, 1.8*inch, 1.0*inch, 1.2*inch, 1.2*inch]))
    story.append(Spacer(1, 8))

    # GRÁFICO 1: bono por antigüedad
    fig, ax = plt.subplots(figsize=(6, 3.2))
    bonos = [800+a*150 for a in años]
    ax.bar([str(a) for a in años], bonos, color="#1f4e79")
    ax.set_title("Bono anual por año de antigüedad (USD)")
    ax.set_xlabel("Año"); ax.set_ylabel("USD")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v,_: f"${v:,.0f}"))
    for i,v in enumerate(bonos):
        ax.text(i, v+40, f"${v:,}", ha="center", fontsize=8)
    story.append(img_from_matplotlib(fig))
    story.append(Spacer(1, 10))

    story.append(Paragraph("1.2 Horarios y modalidad — Schedule and mode", H2))
    story.append(lista([
        "Jornada laboral: 40 h semanales, lunes a viernes. / 40-hour work week, Mon-Fri.",
        "Modalidad híbrida: 3 días presenciales, 2 remotos. / Hybrid: 3 on-site, 2 remote days.",
        "Entrada flexible entre 07:00 y 09:30. / Flexible start between 7:00 and 9:30.",
        "Horas extra al 150%, con aprobación previa. / Overtime at 150%, pre-approved.",
    ]))
    story.append(Spacer(1, 10))

    story.append(Paragraph("1.3 Proceso de vacaciones — Vacation process", H2))
    for i, paso in enumerate([
        "Ingresar al portal RH → 'Solicitud de vacaciones'. / Log into HR portal → 'Vacation request'.",
        "Elegir fechas y verificar saldo. / Choose dates and check balance.",
        "Enviar a aprobación del jefe directo (máx. 48 h). / Send for manager approval (max 48 h).",
        "Confirmación por correo y registro en calendario. / Email confirmation and calendar entry.",
    ], 1):
        story.append(Paragraph(f"<b>Paso {i}:</b> {paso}", BODY))
    story.append(Spacer(1, 10))

    story.append(Paragraph("1.4 Nota sobre la cafetería — Cafeteria note (ruido)", H2))
    story.append(Paragraph(
        "La cafetería del piso 4 abre de 08:00 a 16:00. Código de vestimenta casual en áreas comunes. "
        "Este párrafo es ruido intencional para evaluar el descarte del retriever.", BODY))
    story.append(Paragraph(
        "<i>Cafeteria on floor 4 opens 08:00–16:00. Casual dress code in common areas. "
        "This paragraph is intentional noise for retriever evaluation.</i>", EN))


# ==========================================================
# DOC 2 — API de Pagos
# ==========================================================
def doc2(story):
    story.append(Paragraph("2. API de Pagos v2 — Payments API v2", H2))
    story.append(Paragraph(
        "Base URL: <font face='Courier'>https://api.acmepay.com/v2</font>. "
        "Autenticación con <b>Bearer token</b> en header <i>Authorization</i>.", BODY))
    story.append(Paragraph(
        "<i>Authentication via Bearer token in the Authorization header.</i>", EN))
    story.append(Spacer(1, 8))

    story.append(Paragraph("2.1 Endpoints principales — Main endpoints", H2))
    rows = [
        ["POST",   "/payments",              "Crea un pago / Create payment",  "201"],
        ["GET",    "/payments/{id}",         "Consulta pago / Get payment",    "200"],
        ["POST",   "/payments/{id}/refund",  "Reembolso / Refund",             "200"],
        ["GET",    "/payments?status=ok",    "Lista filtrada / Filtered list", "200"],
        ["DELETE", "/payments/{id}",         "Cancela pendiente / Cancel",     "204"],
    ]
    story.append(tabla_datos(
        ["Método","Ruta","Descripción","HTTP"],
        rows, col_widths=[0.9*inch, 1.9*inch, 2.4*inch, 0.7*inch]))
    story.append(Spacer(1, 8))

    story.append(Paragraph("2.2 Códigos de error — Error codes", H2))
    rows = [
        ["400","Bad Request","Parámetros inválidos / Invalid params"],
        ["401","Unauthorized","Token ausente o expirado / Missing or expired token"],
        ["403","Forbidden","Sin permisos / No permissions"],
        ["404","Not Found","El pago no existe / Payment not found"],
        ["429","Too Many Requests","Límite excedido / Rate limit exceeded"],
        ["500","Server Error","Fallo interno / Internal failure"],
    ]
    story.append(tabla_datos(
        ["Código","Nombre","Causa / Cause"],
        rows, col_widths=[0.8*inch, 1.6*inch, 3.6*inch]))
    story.append(Spacer(1, 8))

    # GRÁFICO 2: latencias simuladas por endpoint
    fig, ax = plt.subplots(figsize=(6, 3))
    eps = ["POST /payments", "GET /payments/{id}", "POST refund", "DELETE"]
    lat = [random.randint(80,150), random.randint(30,70),
           random.randint(150,300), random.randint(40,90)]
    ax.barh(eps, lat, color="#2a7fb8")
    ax.set_xlabel("Latencia p95 (ms)"); ax.set_title("Latencia p95 por endpoint — p95 latency per endpoint")
    for i,v in enumerate(lat): ax.text(v+5, i, f"{v} ms", va="center", fontsize=8)
    story.append(img_from_matplotlib(fig))
    story.append(Spacer(1, 8))

    story.append(Paragraph("2.3 Ejemplo de request — Request example", H2))
    ejemplo = (
        'curl -X POST https://api.acmepay.com/v2/payments \\\n'
        '  -H "Authorization: Bearer TOKEN" \\\n'
        '  -H "Content-Type: application/json" \\\n'
        '  -d \'{"amount": 1500, "currency": "MXN", "method": "card"}\''
    )
    story.append(Paragraph(f"<font face='Courier' size=8>{ejemplo}</font>", BODY))
    story.append(Spacer(1, 8))

    story.append(Paragraph("2.4 Rate limits", H2))
    story.append(lista([
        "Gratuito: 100 req/min, 5,000 req/día. / Free: 100 rpm, 5k/day.",
        "Estándar: 1,000 req/min, 100,000 req/día. / Standard: 1k rpm, 100k/day.",
        "Enterprise: negociable, sin tope. / Negotiable, no cap.",
        "Al exceder: HTTP 429 + header Retry-After (segundos). / On excess: 429 + Retry-After.",
    ]))


# ==========================================================
# DOC 3 — Informe Financiero
# ==========================================================
def doc3(story):
    story.append(Paragraph("3. Informe Financiero Q3 2025 — Q3 2025 Financial Report", H2))
    story.append(Paragraph(
        "Resultados consolidados del tercer trimestre de 2025 (cifras en miles USD, no auditadas). "
        "<i>Consolidated Q3 2025 results (USD thousands, unaudited).</i>", BODY))
    story.append(Spacer(1, 8))

    story.append(Paragraph("3.1 Ingresos por línea — Revenue by line of business", H2))
    lineas = ["Retail","SaaS","Logística","Servicios","Marketplace"]
    ingresos, crecim = [], []
    rows = []
    for l in lineas:
        ing = random.randint(1200, 9800)
        cr  = round(random.uniform(-8, 35), 1)
        mg  = round(random.uniform(12, 42), 1)
        ingresos.append(ing); crecim.append(cr)
        rows.append([l, f"${ing:,}", f"{cr}%", f"{mg}%"])
    story.append(tabla_datos(
        ["Línea","Ingresos","Crecimiento YoY","Margen bruto"],
        rows, col_widths=[1.6*inch, 1.5*inch, 1.6*inch, 1.5*inch]))
    story.append(Spacer(1, 8))

    # GRÁFICO 3: ingresos y crecimiento
    fig, ax1 = plt.subplots(figsize=(6.4, 3.2))
    x = range(len(lineas))
    bars = ax1.bar(x, ingresos, color="#1f4e79", label="Ingresos ($k)")
    ax1.set_xticks(list(x)); ax1.set_xticklabels(lineas, rotation=15)
    ax1.set_ylabel("Ingresos ($k)")
    ax1.yaxis.set_major_formatter(FuncFormatter(lambda v,_: f"${v:,}"))
    for b,v in zip(bars, ingresos):
        ax1.text(b.get_x()+b.get_width()/2, v+100, f"{v}", ha="center", fontsize=7)
    ax2 = ax1.twinx()
    ax2.plot(list(x), crecim, color="#d9534f", marker="o", linewidth=2, label="Crec. YoY %")
    ax2.set_ylabel("Crec. YoY (%)")
    for i,v in enumerate(crecim):
        ax2.text(i, v+1, f"{v}%", ha="center", fontsize=7, color="#d9534f")
    ax1.set_title("Ingresos y crecimiento por línea — Revenue & YoY growth")
    story.append(img_from_matplotlib(fig))
    story.append(Spacer(1, 8))

    story.append(Paragraph("3.2 Gasto operativo — Operating expenses", H2))
    areas = ["Tecnología","Ventas","Marketing","RR.HH.","Operaciones","Legal"]
    rows = [[a, f"${random.randint(80,900):,}", f"${random.randint(60,700):,}",
             f"{round(random.uniform(-10,25),1)}%"] for a in areas]
    story.append(tabla_datos(
        ["Área","Q3 2025","Q3 2024","Var."],
        rows, col_widths=[1.6*inch,1.4*inch,1.4*inch,1.0*inch]))
    story.append(Spacer(1, 8))

    # GRÁFICO 4: pie de distribución de gasto
    fig, ax = plt.subplots(figsize=(5.5, 3.4))
    gastos = [random.randint(100, 800) for _ in areas]
    ax.pie(gastos, labels=areas, autopct="%1.0f%%", startangle=90,
           colors=plt.cm.Blues([0.3,0.45,0.55,0.65,0.75,0.85]))
    ax.set_title("Distribución del gasto por área — Expense split by area")
    story.append(img_from_matplotlib(fig, width=5.5*inch))
    story.append(Spacer(1, 8))

    story.append(Paragraph("3.3 Hallazgos clave — Key findings", H2))
    story.append(lista([
        "SaaS fue la línea con mayor crecimiento (>25% YoY). / SaaS had the highest growth.",
        "Logística se contrajo por costos de combustible. / Logistics contracted on fuel costs.",
        "Margen bruto consolidado +3.2 pp. / Consolidated gross margin +3.2 pp.",
        "Marketing redujo gasto 8% con CAC estable. / Marketing cut spend 8%, CAC stable.",
    ]))
    story.append(Spacer(1, 8))

    story.append(Paragraph("3.4 Advertencia metodológica — Methodology disclaimer", H2))
    story.append(Paragraph(
        "Las cifras incluyen estimaciones y pueden diferir de los estados auditados. "
        "<i>Figures include estimates and may differ from audited statements.</i>", BODY))


# ==========================================================
# DOC 4 — FAQ de Soporte
# ==========================================================
def doc4(story):
    story.append(Paragraph("4. FAQ de Soporte — Support FAQ", H2))
    story.append(Paragraph(
        "Base de conocimiento con preguntas duplicadas y variaciones para evaluar "
        "deduplicación y recuperación semántica. <i>Knowledge base with duplicated questions "
        "and variations for deduplication and semantic retrieval evaluation.</i>", BODY))
    story.append(Spacer(1, 8))

    faqs = [
        ("¿Cómo restablezco mi contraseña? / How do I reset my password?",
         "Ingresa a 'Mi cuenta' → 'Seguridad' → 'Restablecer'. Enlace válido 30 min. "
         "/ Go to 'My account' → 'Security' → 'Reset'. Link valid 30 min."),
        ("¿Cómo recupero mi contraseña si olvidé el correo? / Forgot email password recovery",
         "Contacta a soporte con tu ID de cliente; validamos identidad en 24 h. "
         "/ Contact support with your customer ID; identity validated within 24 h."),
        ("¿Cuál es el horario de soporte? / What are support hours?",
         "Lunes a viernes 08:00–20:00 (GMT-6). Fines de semana urgencias, SLA 4 h. "
         "/ Mon–Fri 8am–8pm (GMT-6). Weekends emergencies, 4 h SLA."),
        ("¿En qué horario atienden? / At what times do you operate?",
         "Atención de lunes a viernes de 8am a 8pm hora central de México. "
         "/ Monday to Friday 8am–8pm Central Mexico Time."),
        ("¿Cómo solicito una factura? / How do I request an invoice?",
         "En 'Facturación' → 'Solicitar factura'. Emitida en <48 h hábiles. "
         "/ In 'Billing' → 'Request invoice'. Issued within 48 business hours."),
        ("¿Puedo cambiar mi plan? / Can I change my plan?",
         "Sí, desde 'Suscripción'. Cambio prorrateado, aplica en el siguiente ciclo. "
         "/ Yes, from 'Subscription'. Prorated, effective next cycle."),
        ("¿Cómo cancelo mi suscripción? / How do I cancel my subscription?",
         "Solicitud desde el portal o bajas@acme.com. Aplica al final del ciclo vigente. "
         "/ Request via portal or bajas@acme.com. Applies at end of current cycle."),
    ]

    rows = [[f"Q{i}", q[:45] + ("…" if len(q)>45 else ""), a[:60] + ("…" if len(a)>60 else "")]
            for i,(q,a) in enumerate(faqs,1)]
    story.append(tabla_datos(
        ["#","Pregunta","Respuesta (resumen)"],
        rows, col_widths=[0.5*inch,2.8*inch,2.8*inch]))
    story.append(Spacer(1, 8))

    story.append(Paragraph("4.1 Detalle de respuestas — Answer details", H2))
    for i,(q,a) in enumerate(faqs,1):
        story.append(Paragraph(f"<b>Q{i}. {q}</b>", BODY))
        story.append(Paragraph(a, BODY))
        story.append(Spacer(1, 4))

    # GRÁFICO 5: temas más consultados
    story.append(Paragraph("4.2 Temas más consultados — Top topics", H2))
    fig, ax = plt.subplots(figsize=(6, 3))
    temas = ["Contraseña","Facturación","Planes","Suscripción","Horarios"]
    vol = [random.randint(80, 400) for _ in temas]
    ax.bar(temas, vol, color="#3a8d5d")
    ax.set_ylabel("Consultas / Tickets")
    ax.set_title("Volumen de tickets por tema — Ticket volume by topic")
    for i,v in enumerate(vol): ax.text(i, v+5, str(v), ha="center", fontsize=8)
    story.append(img_from_matplotlib(fig))
    story.append(Spacer(1, 8))

    story.append(Paragraph("4.3 Glosario — Glossary", H2))
    glosario = [
        ("SLA","Acuerdo de nivel de servicio. / Service level agreement."),
        ("CAC","Costo de adquisición de cliente. / Customer acquisition cost."),
        ("Backoff","Espera incremental en reintentos. / Incremental retry wait."),
        ("Prorrateo","Ajuste proporcional del cobro. / Proportional billing adjustment."),
    ]
    story.append(tabla_datos(
        ["Término","Definición"],
        [[t,d] for t,d in glosario],
        col_widths=[1.2*inch,4.8*inch]))


# ==========================================================
# GROUND TRUTH para evaluación RAG
# ==========================================================
GROUND_TRUTH = {
    "01_rrhh_politicas.pdf": [
        {"q": "¿Cuántos días de vacaciones tiene un empleado con 5 años de antigüedad?",
         "a": "20 días (15 + años de antigüedad).",
         "keywords": ["20 días", "vacaciones", "5 años", "antigüedad"]},
        {"q": "¿Cuál es el horario flexible de entrada?",
         "a": "Entre 07:00 y 09:30.",
         "keywords": ["07:00", "09:30", "flexible"]},
        {"q": "¿Quién aprueba las vacaciones y en cuánto tiempo?",
         "a": "El jefe directo, con respuesta máxima de 48 horas.",
         "keywords": ["jefe directo", "48"]},
        {"q": "¿A qué hora abre la cafetería?",
         "a": "De 08:00 a 16:00 en el piso 4.",
         "keywords": ["08:00", "16:00", "cafetería", "piso 4"]},
    ],
    "02_api_pagos_especificacion.pdf": [
        {"q": "¿Qué método HTTP se usa para crear un pago?",
         "a": "POST en /payments.", "keywords": ["POST", "/payments"]},
        {"q": "¿Qué código devuelve un rate limit excedido?",
         "a": "HTTP 429 Too Many Requests.", "keywords": ["429", "Too Many Requests"]},
        {"q": "¿Cuál es el rate limit del plan estándar?",
         "a": "1,000 req/min y 100,000 req/día.", "keywords": ["1,000", "100,000", "estándar"]},
        {"q": "¿Qué header indica cuándo reintentar tras un 429?",
         "a": "Retry-After (en segundos).", "keywords": ["Retry-After", "segundos"]},
    ],
    "03_informe_financiero_q3.pdf": [
        {"q": "¿Qué línea de negocio creció más en Q3 2025?",
         "a": "SaaS, con crecimiento superior al 25% YoY.", "keywords": ["SaaS", "25%"]},
        {"q": "¿Qué línea se contrajo y por qué?",
         "a": "Logística, por aumento de costos de combustible.",
         "keywords": ["Logística", "combustible"]},
        {"q": "¿Cuánto mejoró el margen bruto consolidado?",
         "a": "3.2 puntos porcentuales.", "keywords": ["3.2", "margen"]},
        {"q": "¿Las cifras están auditadas?",
         "a": "No, son no auditadas e incluyen estimaciones.",
         "keywords": ["no auditadas", "estimaciones"]},
    ],
    "04_faq_soporte.pdf": [
        {"q": "¿Cuánto dura el enlace para restablecer contraseña?",
         "a": "30 minutos.", "keywords": ["30 minutos", "enlace"]},
        {"q": "¿Cuál es el SLA de urgencias en fin de semana?",
         "a": "4 horas.", "keywords": ["4 horas", "SLA", "urgencias"]},
        {"q": "¿En cuánto tiempo se emite una factura?",
         "a": "En menos de 48 horas hábiles.", "keywords": ["48", "factura", "hábiles"]},
        {"q": "¿Cuándo aplica la cancelación de suscripción?",
         "a": "Al final del ciclo vigente.", "keywords": ["final del ciclo", "cancelación"]},
    ],
}

# ==========================================================
# MAIN
# ==========================================================
def main():
    build_pdf("01_rrhh_politicas.pdf", "Manual de Políticas de RR.HH. / HR Policies Handbook", doc1)
    build_pdf("02_api_pagos_especificacion.pdf", "Especificación API de Pagos v2 / Payments API v2", doc2)
    build_pdf("03_informe_financiero_q3.pdf", "Informe Financiero Q3 2025 / Q3 2025 Financial Report", doc3)
    build_pdf("04_faq_soporte.pdf", "FAQ de Soporte al Cliente / Customer Support FAQ", doc4)

    gt_path = os.path.join(OUT_DIR, "ground_truth.json")
    with open(gt_path, "w", encoding="utf-8") as f:
        json.dump(GROUND_TRUTH, f, ensure_ascii=False, indent=2)
    print(f"✅ {gt_path}")
    print("\n🎉 Listo. Revisa ./pdfs_rag/")


if __name__ == "__main__":
    main()