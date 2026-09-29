// Client-side wrappers for the secure server-side Gemini API endpoints

export interface AnalysisError {
  id: string;
  original: string;
  corrected: string;
  explanation: string;
  type: 'ortografía' | 'gramática' | 'puntuación';
  startIndex: number;
  endIndex: number;
}

export interface AnalysisPage {
  name: string;
  verbatim: string;
  errors: AnalysisError[];
  score: number;
}

export interface AnalysisResult {
  verbatim: string;
  errors: AnalysisError[];
  summary: string;
  score: number;
  pages?: AnalysisPage[];
}

export async function analyzeDocument(fileBase64: string, mimeType: string): Promise<AnalysisResult> {
  const response = await fetch('/api/gemini/analyze-document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileBase64, mimeType }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error al procesar el documento (${response.status})`);
  }

  return response.json() as Promise<AnalysisResult>;
}

export async function analyzeMultipleDocuments(files: Array<{ base64: string, mimeType: string }>): Promise<AnalysisResult> {
  const response = await fetch('/api/gemini/analyze-multiple-documents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error al procesar los documentos simultáneos (${response.status})`);
  }

  return response.json() as Promise<AnalysisResult>;
}

export async function analyzeText(input: string): Promise<AnalysisResult> {
  const response = await fetch('/api/gemini/analyze-text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error al analizar el texto (${response.status})`);
  }

  return response.json() as Promise<AnalysisResult>;
}

export async function analyzeMultipleTexts(pages: Array<{ name: string, text: string }>): Promise<AnalysisResult> {
  const response = await fetch('/api/gemini/analyze-multiple-texts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pages }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Error al analizar los textos de las páginas (${response.status})`);
  }

  return response.json() as Promise<AnalysisResult>;
}
