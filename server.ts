import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Prefer efficient, verified, high-quota models first to avoid 429 limits and 503 demand spikes.
const GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.8-flash'
];

const mainKeys = (process.env.GEMINI_API_KEY_MAIN || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

const backupKeys = (process.env.GEMINI_API_KEY_BACKUP || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

if (mainKeys.length === 0 && backupKeys.length === 0) {
  console.warn("ADVERTENCIA: No se encontraron API keys en el archivo .env");
}

const mainClients = mainKeys.map(key => new GoogleGenAI({
  apiKey: key,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build', 'Referer': 'http://localhost:5173' } }
}));

const backupClients = backupKeys.map(key => new GoogleGenAI({
  apiKey: key,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build', 'Referer': 'http://localhost:5173' } }
}));

let mainIndex = 0;
let backupIndex = 0;

function getAiClient(useBackup = false) {
  if (useBackup && backupClients.length > 0) {
    const client = backupClients[backupIndex];
    backupIndex = (backupIndex + 1) % backupClients.length;
    return client;
  }
  if (mainClients.length > 0) {
    const client = mainClients[mainIndex];
    mainIndex = (mainIndex + 1) % mainClients.length;
    return client;
  }
  // Fallback to backup if main is empty
  if (backupClients.length > 0) {
    const client = backupClients[backupIndex];
    backupIndex = (backupIndex + 1) % backupClients.length;
    return client;
  }
  throw new Error("No hay API keys configuradas.");
}

async function generateContentWithFallback(request: any) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt++) {
    for (const model of GEMINI_MODELS) {
      try {
        console.log(`[Gemini] Intentando usar modelo: ${model} (Intento ${attempt + 1})`);
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`TIMEOUT: El modelo ${model} tardó demasiado (60s).`)), 60000);
        });
        
        const useBackup = (attempt >= 1) || (lastError && (lastError as any).status === 'RESOURCE_EXHAUSTED');
        const aiClient = getAiClient(useBackup);
        
        const result = await Promise.race([
          aiClient.models.generateContent({ ...request, model }),
          timeoutPromise
        ]);
        
        console.log(`[Gemini] Éxito con modelo: ${model}`);
        return result;
      } catch (error: any) {
        const detail = JSON.stringify(error) + (error.message || '');
        const retryable = /timeout|429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|404|NOT_FOUND|not found/i.test(detail);
        if (!retryable) {
           console.error(`[Gemini] Error fatal con ${model}:`, error.message);
           throw error;
        }
        console.warn(`[Gemini] Modelo ${model} no disponible (intento ${attempt + 1}). Motivo: ${error.message || 'Rate limit/Timeout'}. Probando respaldo.`);
        lastError = error;
        
        // Si es 429 (Rate Limit), esperamos más tiempo antes de probar el siguiente modelo
        if (/429|RESOURCE_EXHAUSTED/i.test(detail)) {
            console.log(`[Gemini] Límite de cuota alcanzado. Esperando ${(attempt + 1) * 3} segundos...`);
            await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 3000));
        } else {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
    
    // Si todos los modelos fallaron en este intento, esperamos antes del siguiente ciclo
    console.warn(`[Gemini] Todos los modelos fallaron en el intento ${attempt + 1}. Esperando para reintentar...`);
    await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 5000));
  }

  console.error('[Gemini] Todos los intentos y modelos se agotaron.');
  throw lastError;
}

function formatErrorMessage(error: any): string {
  const detail = typeof error?.message === 'string' ? error.message : JSON.stringify(error || '');
  if (/503|UNAVAILABLE|high demand/i.test(detail)) {
    return 'El servicio de IA tiene alta demanda momentánea. Por favor, reintenta en unos instantes.';
  }
  if (/429|RESOURCE_EXHAUSTED/i.test(detail)) {
    return 'Se ha alcanzado temporalmente el límite de peticiones. Por favor, espera un minuto.';
  }
  return error?.message || 'Error al procesar la solicitud.';
}

const errorSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    original: { type: Type.STRING },
    corrected: { type: Type.STRING },
    explanation: { type: Type.STRING },
    type: { type: Type.STRING, enum: ['ortografía', 'gramática', 'puntuación'] },
    startIndex: { type: Type.NUMBER },
    endIndex: { type: Type.NUMBER }
  },
  required: ['id', 'original', 'corrected', 'explanation', 'type', 'startIndex', 'endIndex']
};

const analysisResultSchema = {
  type: Type.OBJECT,
  properties: {
    verbatim: { type: Type.STRING },
    errors: { type: Type.ARRAY, items: errorSchema },
    summary: { type: Type.STRING },
    score: { type: Type.NUMBER },
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          verbatim: { type: Type.STRING },
          errors: { type: Type.ARRAY, items: errorSchema },
          score: { type: Type.NUMBER }
        },
        required: ['name', 'verbatim', 'errors', 'score']
      }
    }
  },
  required: ['verbatim', 'errors', 'summary', 'score']
};

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

function auditInstructions(text: string, label: string) {
  return `Eres un corrector profesional de español. Audita el texto proporcionado de forma exhaustiva, no solo los errores graves.

REGLAS OBLIGATORIAS:
1. El campo verbatim DEBE reproducir exactamente el TEXTO ORIGINAL, carácter por carácter. No lo corrijas, normalices, resumas ni omitas nada.
2. Revisa cada oración y cada palabra. Registra todos los errores detectables de ortografía, gramática y puntuación, incluso faltas pequeñas, tildes, palabras repetidas o palabras de más cuando afecten la redacción.
3. No declares que no hay errores si observas una forma ortográfica, gramatical o de puntuación incorrecta. Por ejemplo, una palabra mal escrita como “palbra” debe figurar como error de ortografía; “a traves” debe marcarse si requiere tilde.
4. Cada error debe citar en original exactamente el fragmento tal como aparece en el texto, ofrecer una corrección puntual y explicar el motivo brevemente.
5. startIndex y endIndex deben apuntar al fragmento original dentro de verbatim. endIndex es exclusivo. Comprueba que verbatim.slice(startIndex, endIndex) sea igual a original.
6. No inventes errores ni reescribas el documento. Si un aspecto admite más de una opción válida, no lo marques.
  7. La explicación ('explanation') debe ser ABSOLUTAMENTE EXACTA sobre el cambio realizado. Si corriges mayúsculas (ej. Tiktok -> TikTok), di "Falta mayúscula intermedia", no inventes otras justificaciones (como afirmar erróneamente que faltan letras). La explicación debe coincidir lógicamente con la diferencia exacta entre 'original' y 'corrected'.

SECCIÓN: ${label}
TEXTO ORIGINAL:
<<<
${text}
>>>
`;
}

function splitForAudit(text: string, maxLength = 6000) {
  if (text.length <= maxLength) return [{ text, offset: 0 }];

  const pieces: Array<{ text: string; offset: number }> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf(String.fromCharCode(10), end),
        text.lastIndexOf('. ', end),
        text.lastIndexOf('; ', end),
        text.lastIndexOf(', ', end)
      );
      if (boundary > start + Math.floor(maxLength * 0.55)) end = boundary + 1;
    }
    pieces.push({ text: text.slice(start, end), offset: start });
    start = end;
  }
  return pieces;
}

function normalizeErrors(rawErrors: any, verbatim: string, offset = 0, idPrefix = 'error') {
  if (!Array.isArray(rawErrors)) return [];

  return rawErrors.flatMap((raw: any, index: number) => {
    const original = typeof raw?.original === 'string' ? raw.original : '';
    if (!original) return [];

    let startIndex = Number(raw.startIndex);
    let endIndex = Number(raw.endIndex);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) ||
        startIndex < 0 || endIndex < startIndex || verbatim.slice(startIndex, endIndex) !== original) {
      startIndex = verbatim.indexOf(original);
      endIndex = startIndex + original.length;
    }
    if (startIndex < 0) return [];

    return [{
      id: String(raw.id || `${idPrefix}-${index + 1}`),
      original,
      corrected: typeof raw.corrected === 'string' ? raw.corrected : '',
      explanation: typeof raw.explanation === 'string' ? raw.explanation : 'Revisar este fragmento.',
      type: ['ortografía', 'gramática', 'puntuación'].includes(raw.type) ? raw.type : 'ortografía',
      startIndex: startIndex + offset,
      endIndex: endIndex + offset
    }];
  });
}

function scoreFromErrors(text: string, errors: any[]) {
  const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
  const weighted = errors.reduce((sum, error) => sum + (error.type === 'gramática' ? 1.25 : error.type === 'puntuación' ? 0.6 : 1), 0);
  return Math.max(0, Math.min(100, 100 - Math.max(errors.length ? 1 : 0, Math.round((weighted / words) * 100))));
}

async function auditText(text: string, name: string) {
  const response = await generateContentWithFallback({
    contents: [{ parts: [{ text: auditInstructions(text, name) }] }],
    config: { responseMimeType: 'application/json', responseSchema: analysisResultSchema }
  });
  const responseText = response.text;
  if (!responseText) throw new Error('No se pudo obtener una respuesta del modelo.');
  const parsed = JSON.parse(responseText);
  const errors = normalizeErrors(parsed.errors, text, 0, name.replace(/\W+/g, '-').toLowerCase());
  return { errors, summary: typeof parsed.summary === 'string' ? parsed.summary : '' };
}

async function analyzeExtractedPages(pages: any[]) {
  const pageResults = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex] || {};
    const verbatim = typeof page.text === 'string' ? page.text : '';
    const name = typeof page.name === 'string' && page.name ? page.name : `Página ${pageIndex + 1}`;

    if (!verbatim.trim()) {
      pageResults.push({ name, verbatim: '', errors: [], score: 100, summary: 'Página sin texto detectable.' });
      continue;
    }

    console.log(`[Extracción] Analizando página ${pageIndex + 1} de ${pages.length}. Tamaño del texto: ${verbatim.length} caracteres.`);

    const chunks = splitForAudit(verbatim);
    console.log(`[Extracción] Página dividida en ${chunks.length} bloques.`);
    const errors: any[] = [];
    const summaries: string[] = [];

    // Sequential calls reduce quota spikes and keep each audit focused.
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      console.log(`[Auditoría] Solicitando Gemini para página ${pageIndex + 1}, bloque ${chunkIndex + 1}...`);
      const chunk = chunks[chunkIndex];
      const label = chunks.length > 1 ? `${name}, bloque ${chunkIndex + 1} de ${chunks.length}` : name;
      const audited = await auditText(chunk.text, label);
      errors.push(...audited.errors.map((error: any) => ({
        ...error,
        id: `p${pageIndex + 1}-${chunkIndex + 1}-${error.id}`,
        startIndex: error.startIndex + chunk.offset,
        endIndex: error.endIndex + chunk.offset
      })));
      if (audited.summary) summaries.push(audited.summary);
    }

    pageResults.push({ name, verbatim, errors, score: scoreFromErrors(verbatim, errors), summary: summaries.join(' ') });
  }

  let globalOffset = 0;
  const globalErrors: any[] = [];
  pageResults.forEach((page) => {
    globalErrors.push(...page.errors.map((error: any) => ({
      ...error,
      startIndex: error.startIndex + globalOffset,
      endIndex: error.endIndex + globalOffset
    })));
    globalOffset += page.verbatim.length + 2;
  });

  const verbatim = pageResults.map((page) => page.verbatim).join(String.fromCharCode(10).repeat(2));
  return {
    verbatim,
    errors: globalErrors,
    summary: globalErrors.length
      ? `Se detectaron ${globalErrors.length} observaciones para revisar.`
      : 'No se detectaron errores en la revisión automática; revisa el original si esperabas una observación concreta.',
    score: scoreFromErrors(verbatim, globalErrors),
    pages: pageResults.map(({ summary: _summary, ...page }) => page)
  };
}

app.post('/api/gemini/analyze-document', async (req, res) => {
  try {
    let { fileBase64, mimeType } = req.body;
    if (!fileBase64) return res.status(400).json({ error: "Falta el parámetro 'fileBase64'." });

    // Derive or default mimeType if missing
    if (!mimeType || typeof mimeType !== 'string' || mimeType.trim() === '') {
      if (fileBase64.startsWith('data:image/png')) mimeType = 'image/png';
      else if (fileBase64.startsWith('data:image/webp')) mimeType = 'image/webp';
      else if (fileBase64.startsWith('data:image/jpeg') || fileBase64.startsWith('data:image/jpg')) mimeType = 'image/jpeg';
      else if (fileBase64.startsWith('data:application/pdf')) mimeType = 'application/pdf';
      else mimeType = 'application/pdf';
    }

    const data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;

    const response = await generateContentWithFallback({
      contents: [{ parts: [
        { text: `Eres un corrector profesional de español. Primero transcribe el texto de la imagen uniendo de forma lógica las palabras. Si el texto tiene un diseño artístico, está escrito en vertical o rotado, NO lo transcribas letra por letra con saltos de línea; únelo de forma lineal en formato de párrafo, PERO CONSERVANDO EXACTAMENTE los mismos errores ortográficos, gramaticales o de tipeo de la imagen. ESTÁ ESTRICTAMENTE PROHIBIDO corregir o mejorar el texto durante la transcripción. Después audita todas las palabras y oraciones para encontrar cada error detectable de ortografía, gramática y puntuación. No ignores errores pequeños. Para cada error, la explicación ('explanation') debe ser ABSOLUTAMENTE EXACTA sobre el cambio realizado. Si corriges mayúsculas (ej. Tiktok -> TikTok), di "Falta mayúscula intermedia", no inventes falsas justificaciones. Devuelve índices exactos: verbatim.slice(startIndex, endIndex) debe ser igual a original. Separa cada página en pages, con errores e índices locales; la raíz consolida todas las páginas.` },
        { inlineData: { data, mimeType } }
      ] }],
      config: { responseMimeType: 'application/json', responseSchema: analysisResultSchema }
    });
    const responseText = response.text;
    if (!responseText) throw new Error('No se pudo obtener respuesta del modelo de IA.');
    return res.json(JSON.parse(responseText));
  } catch (error: any) {
    console.error('Error en /api/gemini/analyze-document:', error);
    return res.status(500).json({ error: formatErrorMessage(error) });
  }
});

app.post('/api/gemini/analyze-multiple-documents', async (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: "Falta el parámetro 'files' o no es un arreglo válido." });

    const parts: any[] = [{ text: 'Transcribe literalmente cada imagen adjunta y revisa exhaustivamente ortografía, gramática y puntuación. No corrijas el texto en verbatim. Devuelve pages por imagen, errores locales y errores globales con índices exactos. No ignores errores menores.' }];
    files.forEach((file: any) => {
      const mime = file.mimeType || (file.base64?.startsWith('data:image/png') ? 'image/png' : 'image/jpeg');
      const data = file.base64?.includes(',') ? file.base64.split(',')[1] : file.base64;
      if (data) {
        parts.push({ inlineData: { data, mimeType: mime } });
      }
    });
    const response = await generateContentWithFallback({
      contents: [{ parts }],
      config: { responseMimeType: 'application/json', responseSchema: analysisResultSchema }
    });
    const responseText = response.text;
    if (!responseText) throw new Error('No se pudo obtener respuesta del modelo de IA.');
    return res.json(JSON.parse(responseText));
  } catch (error: any) {
    console.error('Error en /api/gemini/analyze-multiple-documents:', error);
    return res.status(500).json({ error: formatErrorMessage(error) });
  }
});

app.post('/api/gemini/analyze-text', async (req, res) => {
  try {
    const { input } = req.body;
    if (typeof input !== 'string') return res.status(400).json({ error: "Falta el parámetro 'input'." });
    return res.json(await analyzeExtractedPages([{ name: 'Texto original', text: input }]));
  } catch (error: any) {
    console.error('Error en /api/gemini/analyze-text:', error);
    return res.status(500).json({ error: formatErrorMessage(error) });
  }
});

app.post('/api/gemini/analyze-multiple-texts', async (req, res) => {
  try {
    const { pages } = req.body;
    if (!Array.isArray(pages) || !pages.length) return res.status(400).json({ error: "Falta el parámetro 'pages' o no es un arreglo válido." });
    return res.json(await analyzeExtractedPages(pages));
  } catch (error: any) {
    console.error('Error en /api/gemini/analyze-multiple-texts:', error);
    return res.status(500).json({ error: formatErrorMessage(error) });
  }
});

async function startViteServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`[Escribe Bien CTM] Servidor activo en puerto ${PORT}`));
}

startViteServer().catch((err) => console.error('Error iniciando servidor Vite:', err));








