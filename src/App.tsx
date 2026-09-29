import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Info, PenTool, Image as ImageIcon, FileText, Layers, Trash2 } from 'lucide-react';
import FileUploader from './components/FileUploader';
import HistoryView from './components/HistoryView';
import AnalysisView from './components/AnalysisView';
import HandLogo from './components/HandLogo';
import { analyzeDocument, analyzeText, analyzeMultipleDocuments, analyzeMultipleTexts, AnalysisResult } from './lib/gemini';
import { downloadAnalysisPDF } from './lib/pdf';
import { extractPagesFromPDF } from './lib/pdfExtractor';
import { cn } from './lib/utils';

export default function App() {
  const [view, setView] = useState<'upload' | 'history' | 'analysis'>('upload');
  const [history, setHistory] = useState<any[]>(() => { const saved = localStorage.getItem('ctm_history'); return saved ? JSON.parse(saved) : []; });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<'ocr' | 'text'>('ocr');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<Array<{ file: File, previewUrl: string }>>([]);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStatus, setAnalysisStatus] = useState('');

    const saveToHistory = (newResult: AnalysisResult, fileName: string) => {
    const newItem = {
      id: Date.now().toString(),
      date: Date.now(),
      fileName: fileName || 'Texto Anónimo',
      score: newResult.score,
      errors: newResult.pages.reduce((acc, p) => acc + p.errors.length, 0),
      result: newResult
    };
    setHistory(prev => {
      const updated = [newItem, ...prev].slice(0, 15);
      try { localStorage.setItem('ctm_history', JSON.stringify(updated)); } catch(e) { console.error('History quota exceeded', e); }
      return updated;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('ctm_history');
  };

  useEffect(() => {
    if (!isAnalyzing) {
      setAnalysisProgress(0);
      return;
    }

    const timer = window.setInterval(() => {
      setAnalysisProgress((current) => {
        if (current >= 94) return current;
        // Si es modo texto (PDF), usamos el progreso real después del 40% (extracción)
        if (analysisMode === 'text' && current >= 40) return current;
        
        if (current >= 75) {
          setAnalysisStatus((prev) => prev.includes('página') ? prev : 'Verificando concordancia, acentos y puntuación...');
        } else if (current >= 45) {
          setAnalysisStatus((prev) => prev.includes('página') ? prev : 'Auditando palabras y oraciones con Gemini...');
        }
        return Math.min(94, current + Math.max(1, Math.ceil((94 - current) / 9)));
      });
    }, 800);

    return () => window.clearInterval(timer);
  }, [isAnalyzing, analysisMode]);

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (typeof e.target?.result === 'string') {
          resolve(e.target.result);
        } else {
          reject(new Error(`No se pudo leer el archivo ${file.name}`));
        }
      };
      reader.onerror = () => reject(new Error(`Error al leer el archivo ${file.name}`));
      reader.onabort = () => reject(new Error(`Lectura cancelada de ${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (files: File[], mode: 'image' | 'digital-pdf' | 'scanned-pdf') => {
    setError(null);
    setResult(null);

    if (mode === 'image') {
      const newItems = files.map(file => ({
        file,
        previewUrl: URL.createObjectURL(file)
      }));
      setSelectedImages(prev => [...prev, ...newItems]);
      setAnalysisMode('ocr');
      return;
    }

    const file = files[0];
    if (!file) return;

    setIsAnalyzing(true);
    setAnalysisProgress(8);
    setAnalysisStatus(mode === 'digital-pdf' ? 'Preparando el PDF...' : 'Preparando el documento...');
    setCurrentFileName(file.name);
    setAnalysisMode(mode === 'digital-pdf' ? 'text' : 'ocr');

    try {
      if (mode === 'digital-pdf') {
        let extractedPages: any[] = [];
        try {
          extractedPages = await extractPagesFromPDF(file);
        } catch (pdfErr) {
          console.warn("Fallo al extraer texto del PDF con PDF.js, procesando como escaneado / OCR:", pdfErr);
          extractedPages = [];
        }

        const hasText = extractedPages.length > 0 && extractedPages.some(p => p.text.trim().length > 20);

        if (!hasText) {
          console.log("No se detectóóó texto suficiente. Pasando a modo escaneado automáticamente.");
          setAnalysisProgress(20);
          setAnalysisStatus('El PDF parece ser un escaneo. Leyendo imágenes con OCR...');
          const base64 = await readFileAsBase64(file);
          
          setAnalysisProgress(40);
          setAnalysisStatus('Auditando el documento escaneado...');
          const mimeType = file.type || 'application/pdf';
          const analysisResult = await analyzeDocument(base64, mimeType);
          
          setAnalysisProgress(100);
          setAnalysisStatus('Análisis completado');
          setResult(analysisResult); saveToHistory(analysisResult, currentFileName || 'Texto Anónimo'); setView('analysis');
          setIsAnalyzing(false);
          return;
        }

        const totalPgs = extractedPages.length;
        const allPages = new Array(totalPgs).fill(null);
        let allErrors: any[] = [];
        let verbatimFull = "";
        
        let completedPages = 0;
        
        const processPage = async (page: any, index: number) => {
          try {
            const partialResult = await analyzeMultipleTexts([page]);
            if (partialResult.pages && partialResult.pages.length > 0) {
              allPages[index] = partialResult.pages[0];
            }
          } catch (pageError: any) {
            console.warn(`Página ${index + 1} falló, omitiendo...`, pageError);
            // Inyectar un resultado vacío/falso para que no rompa el PDF completo
            allPages[index] = {
              name: page.name || `Página ${index + 1}`,
              score: 0,
              verbatim: page.text || "",
              errors: [{
                id: `error-skip-${index}`,
                startIndex: 0,
                endIndex: 1,
                suggestion: "⚠️ No se pudo analizar esta página por saturación de Google.",
                reason: "Error de servidor.",
                type: "ortografía",
                severity: "high"
              }]
            };
          } finally {
            completedPages++;
            setAnalysisProgress(Math.floor(40 + (55 * (completedPages / totalPgs))));
            setAnalysisStatus(`Auditando página ${Math.min(completedPages + 1, totalPgs)} de ${totalPgs}... (Doble motor)`);
          }
        };

        await new Promise<void>((resolve) => {
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
              
              setAnalysisStatus(`Auditando página ${Math.min(completedPages + 1, totalPgs)} de ${totalPgs}... (Doble motor)`);
              
              processPage(extractedPages[i], i)
                .then(() => {
                  // Pequeño delay sugerido para no saturar los servidores de Google
                  setTimeout(() => {
                    running--;
                    next();
                  }, 2000);
                });
            }
          };
          next();
        });
        
        // Ensamblar los resultados en orden exacto
        for (let i = 0; i < totalPgs; i++) {
          const pageData = allPages[i];
          if (pageData) {
            const offset = verbatimFull.length;
            const safeErrors = Array.isArray(pageData.errors) ? pageData.errors : [];
            const adjustedErrors = safeErrors.map((err: any) => ({
              ...err,
              id: `real-p${i + 1}-${err.id || Math.random().toString(36)}`,
              startIndex: (err.startIndex || 0) + offset,
              endIndex: (err.endIndex || 1) + offset
            }));
            
            pageData.errors = safeErrors.map((err: any) => ({
              ...err,
              id: `real-p${i + 1}-${err.id || Math.random().toString(36)}`
            }));
            
            allErrors = [...allErrors, ...adjustedErrors];
            verbatimFull += pageData.verbatim + "\n\n";
          }
        }
        
        const validPages = allPages.filter(Boolean);
        const finalScore = validPages.length > 0 
           ? Math.round(validPages.reduce((acc, p) => acc + p.score, 0) / validPages.length) 
           : 100;
           
        setAnalysisProgress(100);
        setAnalysisStatus('Análisis completado');
        const analysisResultFinal = {
           verbatim: verbatimFull.trim(),
           errors: allErrors,
           score: finalScore,
           summary: `Se analizaron ${totalPgs} páginas.`,
           pages: validPages
        };
        setResult(analysisResultFinal);
        saveToHistory(analysisResultFinal, currentFileName || 'Texto Anónimo');
        setView('analysis');
      } else {
        setAnalysisProgress(20);
        setAnalysisStatus('Cargando archivo...');
        const base64 = await readFileAsBase64(file);
        
        setAnalysisProgress(40);
        setAnalysisStatus('Leyendo el documento de forma literal...');
        const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
        const analysisResult = await analyzeDocument(base64, mimeType);
        
        setAnalysisProgress(100);
        setAnalysisStatus('Análisis completado');
        setResult(analysisResult); saveToHistory(analysisResult, currentFileName || 'Texto Anónimo'); setView('analysis');
      }
    } catch (err: any) {
      console.error("Error al procesar el archivo:", err);
      setError(err.message || "Error al procesar el archivo. Asegúrate de que el archivo sea legible.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeImages = async (itemsToAnalyze: Array<{ file: File, previewUrl: string }>) => {
    if (itemsToAnalyze.length === 0) return;
    setIsAnalyzing(true);
    setAnalysisProgress(8);
    setAnalysisStatus('Preparando las imágenes...');
    setError(null);
    setResult(null);
    setAnalysisMode('ocr');
    setCurrentFileName(itemsToAnalyze.map(item => item.file.name).join(', '));

    try {
      const base64Promises = itemsToAnalyze.map(async (item) => {
        const base64 = await readFileAsBase64(item.file);
        const mimeType = item.file.type || (item.file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
        return { base64, mimeType };
      });

      const filesBase64 = await Promise.all(base64Promises);
      setAnalysisProgress(40);
      setAnalysisStatus('Leyendo el texto de las imágenes...');
      const analysisResult = await analyzeMultipleDocuments(filesBase64);
      setAnalysisProgress(100);
      setAnalysisStatus('Análisis completado');
      setResult(analysisResult); saveToHistory(analysisResult, currentFileName || 'Texto Anónimo'); setView('analysis');
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error al analizar las imágenes. Asegúrate de que los archivos sean legibles.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const reset = () => {
    setView('upload');
    setResult(null);
    setError(null);
    setCurrentFileName(null);
    selectedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
    setSelectedImages([]);
  };

  const handleExport = () => {
    if (result) {
      downloadAnalysisPDF(result, currentFileName);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-full h-16 md:w-28 md:h-screen bg-stone-100 flex flex-row md:flex-col items-center justify-between md:justify-start px-4 md:px-0 py-2 md:py-8 gap-2 md:gap-8 z-20 shrink-0 border-t border-slate-200 md:border-r md:border-t-0 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] md:shadow-md">
        <div 
          onClick={reset}
          className="w-14 md:w-20 h-auto flex items-center justify-center cursor-pointer hover:opacity-90 active:scale-95 transition-all select-none shrink-0"
          title="Ir al Inicio"
        >
          <HandLogo className="w-full h-auto drop-shadow-sm" />
        </div>
        
        <nav className="flex flex-row md:flex-col gap-2 md:gap-4 items-center w-full px-2 md:px-4">
          <div onClick={reset} className={cn("flex flex-col items-center gap-1.5 p-2 rounded-xl cursor-pointer transition-all w-14 md:w-full", view !== "history" ? "bg-red-600 text-white shadow-sm hover:bg-red-700" : "bg-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-600")} title="Corregir">
            <FileText className="w-5 h-5 md:w-6 md:h-6" />
            <span className="text-[9px] md:text-[10px] font-medium">Corregir</span>
          </div>
          <div className={cn("flex flex-col items-center gap-1.5 p-2 rounded-xl cursor-pointer transition-all w-14 md:w-full", view === "history" ? "bg-red-600 text-white shadow-sm hover:bg-red-700" : "bg-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-600")} title="Historial" onClick={() => setView('history')}>
            <Layers className="w-5 h-5 md:w-6 md:h-6" />
            <span className="text-[9px] md:text-[10px] font-medium">Historial</span>
          </div>
        </nav>
        
        <div className="hidden md:flex flex-col items-center gap-1.5 p-2 rounded-xl bg-transparent text-slate-400 cursor-pointer hover:bg-slate-50 hover:text-slate-600 transition-all w-full mt-auto mb-2" title="Ayuda">
          <Info className="w-5 h-5 md:w-6 md:h-6" />
          <span className="text-[10px] font-medium">Ayuda</span>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col overflow-hidden relative bg-slate-50">
        {/* Header */}
        <header className="h-14 md:h-20 px-4 md:px-8 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-base md:text-xl font-bold text-slate-800 flex items-center gap-2 md:gap-3">
              <span className="flex items-baseline gap-1">Escribe Bien <span className="font-hand-alt text-red-600 text-2xl md:text-3xl font-bold tracking-tight inline-block -rotate-2 origin-bottom ml-0">CTM</span></span>
              <span className="text-[8px] md:text-[10px] font-bold px-2 py-0.5 bg-red-100 text-red-700 rounded tracking-widest uppercase">
                {view === 'analysis' ? "Analysis Mode" : view === 'history' ? "History Mode" : "Waiting Mode"}
              </span>
            </h1>
            <p className="text-[10px] md:text-xs text-slate-500 truncate max-w-[220px] sm:max-w-md md:max-w-none">
              {currentFileName ? `Documento: ${currentFileName} • Escaneo Literal Activo` : "Detecta errores ortográficos y gramaticales al instante"}
            </p>
          </div>
        </header>

        {/* Content View */}
        <div className={cn(
          "flex-1 custom-scrollbar",
          result ? "overflow-y-auto lg:overflow-hidden lg:flex lg:flex-col" : "overflow-y-auto"
        )}>
          <div className={cn(
            "max-w-[1400px] mx-auto w-full",
            result ? "p-3 md:px-8 md:pt-4 md:pb-6 xl:flex-1 xl:flex xl:flex-col xl:h-full xl:min-h-0" : "p-4 md:p-8"
          )}>
            <AnimatePresence mode="wait">
              {view === 'upload' && !result && !isAnalyzing && selectedImages.length > 0 ? (
                <motion.div
                  key="image-aggregator"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="space-y-8 py-6"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-6xl pb-4 border-b border-slate-200">
                    <div className="space-y-1">
                      <h2 className="text-3xl font-black tracking-tight text-slate-900 uppercase">
                        Imágenes Seleccionadas
                      </h2>
                      <p className="text-sm text-slate-500">
                        Has cargado <span className="font-bold text-red-600">{selectedImages.length}</span> {selectedImages.length === 1 ? 'imagen' : 'imágenes'} para transcripción y análisis combinado.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          selectedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
                          setSelectedImages([]);
                        }}
                        className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-600 hover:text-slate-900 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleAnalyzeImages(selectedImages)}
                        className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold uppercase tracking-widest shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
                      >
                        <PenTool className="w-4 h-4" />
                        Analizar {selectedImages.length} {selectedImages.length === 1 ? 'Imagen' : 'Imágenes'}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm font-medium flex items-center gap-2 max-w-2xl">
                        <Info className="w-4 h-4" />
                        {error}
                    </div>
                  )}

                  {/* Grid of images */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 max-w-6xl">
                    {selectedImages.map((item, idx) => (
                      <div key={idx} className="relative group bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow aspect-square flex flex-col">
                        {/* Image Thumbnail */}
                        <div className="flex-1 overflow-hidden bg-slate-100 flex items-center justify-center relative">
                          <img 
                            src={item.previewUrl} 
                            alt={item.file.name} 
                            className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300" 
                            referrerPolicy="no-referrer"
                          />
                          {/* Delete Button */}
                          <button
                            onClick={() => {
                              URL.revokeObjectURL(item.previewUrl);
                              setSelectedImages(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="absolute top-2 right-2 p-1.5 bg-white/95 rounded-lg text-rose-600 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-50 hover:text-rose-700"
                            title="Eliminar imagen"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        {/* File info */}
                        <div className="p-3 border-t border-slate-100 bg-white">
                          <p className="text-xs font-bold text-slate-800 truncate" title={item.file.name}>
                            {item.file.name}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {(item.file.size / 1024).toFixed(0)} KB
                          </p>
                        </div>
                      </div>
                    ))}

                    {/* Add More card */}
                    <div 
                      onClick={() => {
                        const fileInput = document.createElement('input');
                        fileInput.type = 'file';
                        fileInput.multiple = true;
                        fileInput.accept = 'image/*';
                        fileInput.onchange = (e: any) => {
                          if (e.target.files) {
                            const files = Array.from(e.target.files) as File[];
                            const imageFiles = files.filter(f => f.type.startsWith('image/'));
                            if (imageFiles.length > 0) {
                              const newItems = imageFiles.map(file => ({
                                file,
                                previewUrl: URL.createObjectURL(file)
                              }));
                              setSelectedImages(prev => [...prev, ...newItems]);
                            }
                          }
                        };
                        fileInput.click();
                      }}
                      className="border-2 border-dashed border-slate-200 hover:border-red-400 rounded-xl flex flex-col items-center justify-center p-6 bg-slate-50 hover:bg-red-50/20 cursor-pointer transition-colors aspect-square text-center gap-3 group"
                    >
                      <div className="w-10 h-10 bg-white rounded-lg border border-slate-200 flex items-center justify-center group-hover:scale-105 transition-transform duration-200 shadow-sm">
                        <ImageIcon className="w-5 h-5 text-red-600" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-tight">Cargar Más</p>
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest font-semibold mt-0.5">Añadir Imágenes</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : view === 'upload' && !result && !isAnalyzing && selectedImages.length === 0 ? (
                <motion.div
                  key="uploader"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="space-y-10 py-6 md:py-12 max-w-5xl mx-auto w-full px-4 md:px-8"
                >
                  <div className="max-w-3xl space-y-4">
                    <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-[0.9] text-slate-900 uppercase">
                       DEJA DE <br /> <span className="text-red-600 inline-block font-hand text-[1.2em] sm:text-[1.3em] md:text-[1.4em] font-bold tracking-normal normal-case -rotate-2 transform origin-left ml-0 mt-2">escribir mal</span>
                    </h2>
                    <p className="text-base md:text-lg text-slate-500 max-w-xl leading-relaxed">
                      Tu <span className="font-bold text-red-600 font-hand-alt text-2xl md:text-3xl inline-block -rotate-2">CTM</span> <strong className="text-slate-700">(Corrector Textual Maestro)</strong> definitivo. Sube tus im&aacute;genes o documentos y nuestra IA se encarga de fulminar tus errores ortogr&aacute;ficos y gramaticales en segundos para que dejes de pasar verg&uuml;enza.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                    <FileUploader 
                      onFileSelect={handleFileSelect} 
                      mode="image"
                      accept="image/*"
                      title="Imágenes Sueltas"
                      description="Capturas, fotos de pizarra o notas a mano. Formatos JPG, PNG, WEBP."
                      icon={<ImageIcon className="w-6 h-6 text-red-600" />}
                    />
                    <FileUploader 
                      onFileSelect={handleFileSelect} 
                      mode="digital-pdf"
                      accept=".pdf"
                      title="Documento PDF"
                      description="Sube cualquier PDF. Detectaráá automáticamente si es digital o un escaneo."
                      icon={<FileText className="w-6 h-6 text-red-600" />}
                    />
                  </div>
                  
                  {error && (
                    <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm font-medium flex items-center gap-2 max-w-2xl">
                        <Info className="w-4 h-4" />
                        {error}
                    </div>
                  )}
                </motion.div>
              ) : isAnalyzing ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="min-h-[500px] flex flex-col items-center justify-center text-center space-y-6"
                >
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-slate-200 rounded-full" />
                    <div className="absolute inset-0 w-20 h-20 border-t-4 border-red-600 rounded-full animate-spin" />
                  </div>
                    <div className="space-y-1 flex flex-col items-center w-full">
                      <h3 className="text-xl font-bold text-slate-800 uppercase tracking-tight">
                      {analysisStatus || (analysisMode === 'ocr' ? "Escaneando Píxeles..." : "Extrayendo Texto...")}
                    </h3>
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">
                      {analysisMode === 'ocr' ? "Utilizando OCR de Alta Fidelidad" : "Base de datos de caracteres activa"}
                    </p>
                    <div className="w-full max-w-sm pt-4" aria-live="polite">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                        <span>Progreso</span>
                        <span>{analysisProgress}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                        <motion.div
                          className="h-full rounded-full bg-red-600"
                          initial={false}
                          animate={{ width: analysisProgress + '%' }}
                          transition={{ duration: 0.35, ease: 'easeOut' }}
                        />
                      </div>
                    </div>

                    <div className="pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAnalyzing(false);
                          setAnalysisProgress(0);
                          setError("Análisis cancelado.");
                        }}
                        className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-lg transition-colors cursor-pointer"
                      >
                        Cancelar análisis
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : view === 'history' ? ( <HistoryView key="history" history={history} onSelect={(item) => { setResult(item.result); setCurrentFileName(item.fileName); setView('analysis'); }} onClear={clearHistory} /> ) : result && view === 'analysis' ? (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="xl:flex-1 xl:flex xl:flex-col xl:min-h-0 xl:h-full"
                >
                  <AnalysisView result={result} onExport={handleExport} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>


      </main>
    </div>
  );
}

const CheckCircle2 = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);























