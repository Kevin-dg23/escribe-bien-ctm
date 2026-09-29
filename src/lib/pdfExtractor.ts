import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - Vite specific import
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface ExtractedPage {
  name: string;
  text: string;
}

export async function extractPagesFromPDF(file: File): Promise<ExtractedPage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    useSystemFonts: true,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Tiempo de espera agotado al extraer el PDF. El documento es demasiado grande.')), 60000)
  );

  const pdf = await Promise.race([loadingTask.promise, timeoutPromise]);
  
  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => (item && typeof item.str === 'string' ? item.str : ''))
      .filter(Boolean)
      .join(' ');
    pages.push({
      name: `Página ${i}`,
      text: pageText.trim()
    });
  }
  
  return pages;
}

export async function extractTextFromPDF(file: File): Promise<string> {
  const pages = await extractPagesFromPDF(file);
  return pages.map(p => p.text).join('\n');
}
