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

export async function convertPDFToImages(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    useSystemFonts: true,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Tiempo de espera agotado al renderizar el PDF.')), 120000)
  );

  const pdf = await Promise.race([loadingTask.promise, timeoutPromise]);
  const imagesBase64: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const originalViewport = page.getViewport({ scale: 1.0 });
    // Scale so width is around 1000px max to save payload size
    const scale = Math.min(1.5, 1000 / originalViewport.width);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) continue;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    // Convert to compressed jpeg, removing 'data:image/jpeg;base64,' prefix for Gemini API compatibility
    const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    const base64Data = dataUrl.split(',')[1];
    imagesBase64.push(base64Data);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }

  return imagesBase64;
}


