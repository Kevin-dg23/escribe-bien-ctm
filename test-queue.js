import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

async function test() {
  const fileBuffer = fs.readFileSync('C:/Users/pskev/.gemini/antigravity/brain/f15e3219-2a07-49de-b40b-cc5ceca824be/.user_uploaded/media_1790619641346.pdf');
  const uint8Array = new Uint8Array(fileBuffer);

  const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
  const pdf = await loadingTask.promise;
  
  console.log(`PDF loaded. Total pages: ${pdf.numPages}`);
  
  const extractedPages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items.filter((item) => item && typeof item.str === 'string' && item.str.trim() !== '');
    
    items.sort((a, b) => {
      const yA = a.transform[5];
      const yB = b.transform[5];
      const xA = a.transform[4];
      const xB = b.transform[4];
      if (Math.abs(yA - yB) < 10) return xA - xB;
      return yB - yA;
    });

    const pageText = items.map((item) => item.str).join(' ');
    extractedPages.push({ name: `Página ${i}`, text: pageText.trim() });
  }
  
  console.log(`Extracted text from ${extractedPages.length} pages. Starting queue...`);
  
  const totalPgs = extractedPages.length;
  const allPages = new Array(totalPgs).fill(null);
  let completedPages = 0;
  
  const processPage = async (page, index) => {
    try {
      const response = await fetch('http://localhost:3000/api/gemini/analyze-multiple-texts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: [page] })
      });
      if (!response.ok) throw new Error('HTTP error ' + response.status);
      const partialResult = await response.json();
      
      if (partialResult.pages && partialResult.pages.length > 0) {
        allPages[index] = partialResult.pages[0];
        console.log(`[SUCCESS] Page ${index + 1}/${totalPgs} completed.`);
      }
    } catch (pageError) {
      console.warn(`[ERROR] Page ${index + 1} failed:`, pageError.message);
      allPages[index] = {
        verbatim: page.text || "",
        errors: [{ id: `error-skip-${index}`, startIndex: 0, endIndex: 1, suggestion: "⚠️ Error", reason: "Error", severity: "high" }]
      };
    } finally {
      completedPages++;
    }
  };

  await new Promise((resolve) => {
    let running = 0;
    let queueIndex = 0;
    const next = () => {
      if (completedPages === totalPgs) {
        resolve();
        return;
      }
      while (running < 2 && queueIndex < totalPgs) {
        const i = queueIndex++;
        running++;
        processPage(extractedPages[i], i).then(() => {
          setTimeout(() => { running--; next(); }, 2000);
        });
      }
    };
    next();
  });
  
  console.log('All pages processed! Assembly starting...');
  console.log(allPages.map(p => p.errors.length + ' errors').join(', '));
}

test().catch(console.error);
