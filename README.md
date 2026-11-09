# RAG - Sistema de Ingesta y Búsqueda de Información

Sistema de **Retrieval-Augmented Generation (RAG)** con NestJS: subes tus documentos (PDF, DOCX, TXT, MD, HTML y CSV) y haces preguntas en lenguaje natural sobre su contenido, con respuestas basadas **solo** en tus documentos y citando las fuentes.

## 🎯 Objetivo

Permitir a los usuarios cargar documentos propios y consultarlos en lenguaje natural, obteniendo respuestas precisas basadas en la información almacenada, sin depender de servicios de base de datos externos: los vectores viven en un único archivo SQLite.

## 🚀 Características

- **Ingesta multi-formato**: PDF, DOCX, TXT, MD, HTML y CSV, con extracción de texto y división automática en chunks con solape.
- **Búsqueda semántica**: similitud vectorial con `sqlite-vec` (índice `vec0`).
- **Consultas en lenguaje natural**: el LLM responde usando los chunks recuperados como contexto.
- **Trazabilidad**: cada respuesta incluye las fuentes (`sources`).
- **Re-subida segura**: subir otra vez el mismo documento reemplaza su versión anterior sin duplicar datos.
- **IDs sin colisiones**: `informe.pdf` → `informe-pdf` e `informe.docx` → `informe-docx`.
- **Almacenamiento local**: documentos en `uploads/`, metadatos y vectores en `data/rag.db`.
- **Sin Docker**: no hace falta ningún servicio adicional corriendo.

## 🛠️ Stack Tecnológico

| Pieza | Tecnología |
|---|---|
| Backend | NestJS 11 |
| Base de datos vectorial | SQLite + `better-sqlite3` + `sqlite-vec` |
| Chat (LLM) | Cualquier API compatible con OpenAI (ejemplo: **Groq**) |
| Embeddings | Cualquier API compatible con OpenAI (ejemplo: **OpenRouter**) |
| Orquestación | LangChain (`@langchain/openai`) |
| Extracción de PDF | `pdf-parse` v2 |
| Extracción de DOCX | `mammoth` |
| Extracción de HTML | `html-to-text` |
| Validación de ZIP/DOCX | `unzipper` (anti zip-bomb) |

> **Importante**: chat y embeddings usan **proveedores distintos y variables distintas**. Groq sirve chat pero **no** tiene endpoint de embeddings; por eso los embeddings van a OpenRouter con `EMBEDDINGS_*`.

## 💡 ¿Por qué SQLite-vec?

- **Todo en uno**: un solo archivo `.db` contiene documentos, chunks y vectores.
- **Sin Docker**: no requiere servicios externos corriendo.
- **Portabilidad**: fácil de mover, copiar y respaldar.
- **Simplicidad**: ideal para aplicaciones standalone y desarrollo local.

## 📋 Requisitos Previos

- Node.js 18+
- Una API key de un proveedor de **chat** compatible con OpenAI (p. ej. Groq).
- Una API key de un proveedor de **embeddings** compatible con OpenAI (p. ej. OpenRouter).

## ⚙️ Instalación

```bash
npm install
cp .env.example .env   # y rellena las claves
npm run start:dev
```

La app arranca en `http://localhost:3000/api/v1` (o `PORT`). Al iniciar crea `data/` y `uploads/` si no existen y registra `Base de datos SQLite inicializada con sqlite-vec`.

### Variables de entorno

Las marcadas como obligatorias se leen con `getOrThrow`: si falta alguna, el arranque falla de inmediato con un mensaje claro en lugar de usar un valor por defecto silencioso.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_PATH` | ✅ | Ruta del archivo SQLite. La carpeta se crea sola. |
| `UPLOAD_DIR` | ✅ | Carpeta donde se guardan los documentos subidos. |
| `OPENAI_BASE_URL` | ✅ | URL base del proveedor de **chat** (ej. `https://api.groq.com/openai/v1`). |
| `OPENAI_API_KEY` | ✅ | API key del proveedor de chat. |
| `OPENAI_MODEL` | ✅ | Modelo de chat (ej. `qwen/qwen3.8-27b` en Groq). |
| `EMBEDDINGS_BASE_URL` | ✅ | URL base del proveedor de **embeddings** (ej. `https://openrouter.ai/api/v1`). |
| `EMBEDDINGS_API_KEY` | ✅ | API key **del proveedor de embeddings** (no la de chat). |
| `EMBEDDINGS_MODEL` | ➖ | Modelo de embeddings. Por defecto `openai/text-embedding-3-small` (1536 dimensiones). |
| `PORT` | ➖ | Puerto HTTP. Por defecto `3000`. |
| `CORS_ORIGIN` | ➖ | Orígenes permitidos por CORS, separados por comas. Por defecto `http://localhost:4200`. |
| `THROTTLE_TTL_MS` | ➖ | Ventana de rate limiting en milisegundos. Por defecto `60000`. |
| `THROTTLE_LIMIT` | ➖ | Máximo de peticiones por IP y ventana. Por defecto `20`. |
| `ALLOWED_FILE_TYPES` | ➖ | Formatos permitidos, separados por comas. Por defecto `pdf,docx,txt,md,html,csv`. |
| `MAX_FILE_SIZE_MB` | ➖ | Tamaño máximo por archivo en MB. Por defecto `10`. |
| `MAX_UNCOMPRESSED_MB` | ➖ | Tamaño máximo descomprimido de un DOCX (anti zip-bomb). Por defecto `50`. |
| `WATCH_DIR` | ➖ | Directorio que monitorea el servicio automático de ingesta (por defecto `UPLOAD_DIR`). Cuando se escribe un documento permitido ahí, se ingiere sin necesidad de subirlo por API. |
| `SCAN_INTERVAL_MS` | ➖ | Intervalo, en milisegundos, para el escaneo de respaldo del directorio observado. Por defecto `5000`. |

## 🔌 Endpoints

Todos los endpoints viven bajo el prefijo versionado **`/api/v1`**.

### `POST /api/v1/documents/upload`

Sube un documento (`multipart/form-data`, campo **`file`**). Formatos por defecto: `.pdf`, `.docx`, `.txt`, `.md`, `.html` y `.csv` (configurable con `ALLOWED_FILE_TYPES`). Tamaño máximo `10MB` (`MAX_FILE_SIZE_MB`).

Validaciones:
- Extensión dentro de la allowlist.
- Firma real: `%PDF-` para PDF y ZIP/OOXML para DOCX.
- Texto UTF-8 sin bytes NUL en TXT/MD/HTML/CSV.
- DOCX: se inspecciona el ZIP y se rechazan zip bombs (`MAX_UNCOMPRESSED_MB`).
- Nombres con rutas (path traversal) se rechazan.

Si ya existe un documento con el mismo nombre y extensión, se reemplaza. El `documentId` se forma con el nombre base y la extensión (`informe.pdf` → `informe-pdf`).

```bash
curl -X POST http://localhost:3000/api/v1/documents/upload -F "file=@documento.pdf"
curl -X POST http://localhost:3000/api/v1/documents/upload -F "file=@informe.docx"
curl -X POST http://localhost:3000/api/v1/documents/upload -F "file=@notas.txt"
```

```json
{ "message": "Documento procesado exitosamente", "documentId": "documento-pdf", "chunks": 4 }
```

> No pongas la cabecera `Content-Type` a mano: el cliente debe generarla con su `boundary`. Ver [errores conocidos](#-errores-conocidos).

### `GET /api/v1/documents`

Lista los documentos indexados, del más reciente al más antiguo.

```bash
curl http://localhost:3000/api/v1/documents
```

### `POST /api/v1/rag/ask`

Responde una pregunta usando los 3 chunks más similares como contexto. El body se valida: `question` es obligatorio, no vacío y de máximo 2000 caracteres.

```bash
curl -X POST http://localhost:3000/api/v1/rag/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"¿De qué trata el documento?"}'
```

```json
{
  "answer": "Según el contexto, ...",
  "sources": ["documento.pdf"]
}
```

## 🧠 Cómo funciona

**Ingesta** (`DocumentsService`):

1. Valida nombre, extensión permitida, tamaño, firma y contenido (`FileValidationService`).
2. Extrae el texto con el extractor del formato: `pdf-parse` v2 para PDF (libera el worker con `destroy()`), `mammoth` para DOCX, `html-to-text` para HTML y texto plano para TXT/MD/CSV.
3. Guarda el documento en `UPLOAD_DIR` (solo si la extracción fue correcta).
4. Divide el texto en chunks de 1000 caracteres con 200 de solape.
5. Pide los embeddings a `EMBEDDINGS_BASE_URL` y valida que sean de 1536 dimensiones.
6. En **una sola transacción**: borra la versión previa de ese documento (chunks y vectores incluidos) e inserta documento, chunks y vectores. Si algo falla, no queda nada a medias.

El `documentId` se calcula como `nombre-base + extensión` (`informe.docx` → `informe-docx`), así dos formatos con el mismo nombre no colisionan.

**Consulta** (`RagService`):

1. Genera el embedding de la pregunta.
2. Busca los 3 vecinos más cercanos en `vec_chunks` con KNN (`k = ?`).
3. Recupera el texto de esos chunks y sus fuentes.
4. Envía contexto + pregunta al proveedor de chat y devuelve la respuesta.

### Servicio de ingesta automática

El módulo `DocumentsModule` inyecta `DirectoryIngestorService`. Éste monitoriza un directorio (`WATCH_DIR`, por defecto `UPLOAD_DIR`) y, cuando aparece un documento de un tipo permitido, lo envía a `DocumentsService.processAndStoreDocument(...)` exactamente igual que lo hace `POST /api/v1/documents/upload`. La ingesta (validar, extraer texto, chunkear, generar embeddings y guardar en `data/rag.db`) es la misma; la única diferencia es que el archivo llega por el sistema de ficheros. Al eliminar el archivo del directorio se borran su documento, chunks y vectores.

Para activarlo añade al `.env`:

```bash
WATCH_DIR=./uploads
SCAN_INTERVAL_MS=5000
```

## 🗂️ Estructura del Proyecto

```
src/
├── app.module.ts            # ConfigModule global y módulos de la app
├── main.ts                  # Bootstrap HTTP
├── config/
│   ├── embeddings.config.ts # Cliente de embeddings compartido + validación de dimensión
│   └── provider-errors.ts   # Traduce errores de proveedores a respuestas HTTP claras
├── database/
│   ├── database.module.ts
│   └── database.service.ts  # Conexión SQLite, extensión sqlite-vec y tablas
├── documents/
│   ├── documents.controller.ts
│   ├── documents.module.ts
│   ├── documents.service.ts       # Orquesta la ingesta
│   ├── file-types.ts              # Allowlist, detección, docId y firmas
│   ├── file-validation.service.ts # Validación y anti zip-bomb
│   ├── directory-ingestor.service.ts
│   └── parsers/                   # Extractores por formato
└── rag/
    ├── rag.controller.ts
    ├── rag.module.ts
    └── rag.service.ts       # Recuperación de contexto + respuesta del LLM
```

Tablas: `documents` (metadatos), `chunks` (texto y fuente) y `vec_chunks` (`vec0`, `embedding FLOAT[1536]`). `vec_chunks` no tiene foreign key, así que al borrar un documento hay que borrar sus vectores explícitamente.

## 🧪 Scripts

```bash
npm run start:dev   # desarrollo con watch
npm run build       # compila a dist/
npm run start:prod  # ejecuta dist/main
npm test            # tests unitarios (Jest, 42 tests)
npm run test:cov    # lo mismo con cobertura
npm run lint        # ESLint con --fix
```

### Tests

Los scripts de npm ejecutan Jest con `--experimental-vm-modules` (ver [errores conocidos](#-errores-conocidos)); usa siempre `npm test` y no llames `jest` directamente.

Las 8 suites (42 tests) no usan la red: los clientes de chat y embeddings se sustituyen por dobles, pero **la base de datos es real** (`sqlite-vec` en memoria) y **los documentos son reales** (PDF y DOCX generados por código), así que se comprueba de punta a punta:

- **Ingesta**: extracción con `pdf-parse`, `mammoth` y `html-to-text`, troceado de 1000/200 verificado contra el texto extraído, inserción de documento + chunks + vectores de 1536 dimensiones, re-subida sin duplicar, colisión PDF/DOCX resuelta, PDF corrupto → 400, error de proveedor → 502 y dimensión incorrecta → aviso claro.
- **Validación**: allowlist, firmas de PDF/ZIP, UTF-8 sin NUL, tamaño máximo, path traversal, ZIP que no es DOCX y zip bomb.
- **Búsqueda vectorial**: KNN real contra `vec0` con `k = 3`, orden por distancia, contexto limitado a los 3 chunks más cercanos, base vacía sin inventar respuesta y traducción de errores de embeddings/chat.
- **Controllers**: falta de archivo, respuestas correctas con el servicio mockeado y listado de documentos.

## 🩺 Errores conocidos

| Error | Causa | Solución |
|---|---|---|
| `404 The model 'text-embedding-3-small' does not exist or you do not have access to it` (cabeceras `x-groq-region`) | Los embeddings se piden al proveedor de **chat**. Groq no tiene endpoint de embeddings y el SDK de `openai` hereda `OPENAI_BASE_URL` si el cliente no recibe `baseURL` explícito. | Usa siempre `createEmbeddings()` de `src/config/embeddings.config.ts` y revisa `EMBEDDINGS_BASE_URL` / `EMBEDDINGS_API_KEY`. |
| `Multipart: Boundary not found` (400) | La petición no es un formulario multipart real: se puso `Content-Type: multipart/form-data` a mano sin `boundary`. | En Postman usa Body → form-data con el campo `file`, o `curl -F "file=@archivo.pdf"`. No escribas la cabecera. |
| `UNIQUE constraint failed: documents.id` | Se subía un documento con un nombre ya indexado. | Resuelto: la re-subida reemplaza la versión anterior en una transacción. |
| `A LIMIT or 'k = ?' constraint is required on vec0 knn queries` | El `LIMIT` iba en la consulta exterior con `JOIN`; el índice `vec0` no lo ve. | Resuelto: la KNN va en subconsulta con `k = ?`. |
| `Argument of type 'string \| undefined' is not assignable to parameter of type 'string'` | `ConfigService.get<T>()` devuelve `T \| undefined` aunque la variable exista. | Usa `getOrThrow<T>()` para variables obligatorias. |
| `Type 'typeof import("...pdf-parse")' has no call signatures` | `pdf-parse` v2 exporta la clase `PDFParse`, no una función. | `new PDFParse({ data }).getText()` y `destroy()` en `finally`. |
| `Modelo no disponible en el proveedor` (502) | `OPENAI_MODEL` o `EMBEDDINGS_MODEL` no existe en ese proveedor. | Revisa el nombre exacto del modelo en el catálogo del proveedor. |
| `Credenciales rechazadas` (502) | La API key pertenece a otro proveedor (p. ej. una clave de Groq en `EMBEDDINGS_API_KEY`). | Usa una clave del proveedor correcto. |
| `El documento ... no contiene texto extraíble` (400) | PDF escaneado (solo imágenes) o documento sin texto. | Requiere OCR, que esta app no incluye. |
| `... se expande por encima de XMB (posible zip bomb)` (400) | DOCX con contenido comprimido desproporcionado. | Sube un DOCX legítimo o ajusta `MAX_UNCOMPRESSED_MB`. |
| `... no es un tipo de archivo permitido` (400) | Extensión fuera de `ALLOWED_FILE_TYPES`. | Añade el formato a la variable o sube uno permitido. |
| `Must use import to load ES Module: node_modules/@nestjs/config/dist/index.js` (al ejecutar `npm test`) | `@nestjs/config` es solo ESM y Jest ejecuta los tests como CommonJS; sin más flags, Jest no puede cargarlo. | Resuelto: los scripts de npm lanzan Jest con `node --experimental-vm-modules`. Ejecuta siempre `npm test`, no `jest` a pelo. |
| `... devolvió N dimensiones, pero la tabla espera FLOAT[1536]` | `EMBEDDINGS_MODEL` no da 1536 dimensiones. | Usa un modelo de 1536 dimensiones o cambia la tabla y reindexa. |

## 🔁 Reindexar

Los embeddings dependen del modelo: si cambias `EMBEDDINGS_MODEL`, borra `data/rag.db` (y opcionalmente `uploads/`) y vuelve a subir los documentos.

> **Cambio de formato de `docId`**: las versiones anteriores usaban el nombre sin extensión. Si actualizas desde esa versión, borra `data/rag.db` para evitar ids duplicados y reindexa.

Como `data/` y `uploads/` están en `.gitignore`, una instalación nueva empieza vacía.

## 📌 Notas y límites conocidos

- El troceado es por caracteres fijos: puede partir palabras o frases a la mitad y degradar un poco la recuperación.
- Hay rate limiting global (`THROTTLE_*`) y CORS configurable, pero no autenticación: pensado para uso local.
- Un documento se identifica por `nombre-base + extensión` (`informe.pdf` → `informe-pdf`), así que dos formatos con el mismo nombre base no colisionan.
- CSV se indexa como texto plano, sin semántica de columnas.
- PDFs escaneados e imágenes requieren OCR, que esta app no incluye.
