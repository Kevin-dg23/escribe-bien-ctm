import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { CheckCircle2, AlertCircle, EyeOff, Eye, Minimize2, Maximize2, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AnalysisResult, AnalysisError } from '../lib/gemini';
import { cn } from '../lib/utils';

interface AnalysisViewProps {
  result: AnalysisResult;
  onExport: () => void;
}

export default function AnalysisView({ result, onExport }: AnalysisViewProps) {
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
  const [activePageIndex, setActivePageIndex] = useState<number | 'all'>('all');
  const toggleIgnore = (id: string) => {
    setIgnoredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const currentPageData = useMemo(() => {
    if (activePageIndex === 'all' || !result.pages || !result.pages[activePageIndex]) {
      return {
        verbatim: result.verbatim,
        errors: result.errors,
        score: result.score
      };
    }
    return {
      verbatim: result.pages[activePageIndex].verbatim,
      errors: result.pages[activePageIndex].errors,
      score: result.pages[activePageIndex].score
    };
  }, [result, activePageIndex]);

  const activeErrors = useMemo(() => 
    currentPageData.errors.filter(e => !ignoredIds.has(e.id)),
  [currentPageData.errors, ignoredIds]);
  const calculatedScore = useMemo(() => {
    const wordCount = currentPageData.verbatim.trim().split(/\s+/).filter(Boolean).length;
    if (currentPageData.errors.length === 0) return 100;

    const weightedErrors = currentPageData.errors.reduce((total, error) => {
      const weight = error.type === 'gramática' ? 1.25 : error.type === 'puntuación' ? 0.6 : 1;
      return total + weight;
    }, 0);
    const penalty = Math.max(5, Math.round((weightedErrors / Math.max(wordCount, 8)) * 100));
    return Math.max(0, 100 - penalty);
  }, [currentPageData.errors, currentPageData.verbatim]);


  // Align error indices robustly with actual verbatim text in case Gemini indices are slightly off
  const alignedActiveErrors = useMemo(() => {
    const text = currentPageData.verbatim;
    return activeErrors.map(error => {
      let start = error.startIndex;
      let end = error.endIndex;
      const original = error.original ? error.original.trim() : '';
      
      if (original) {
        // Search window of 50 characters around the suggested startIndex (high likelihood of nearby match)
        const windowSize = 50;
        const windowStart = Math.max(0, error.startIndex - windowSize);
        const windowEnd = Math.min(text.length, error.endIndex + windowSize);
        const searchWindow = text.slice(windowStart, windowEnd);
        
        let foundOffset = searchWindow.indexOf(original);
        if (foundOffset === -1) {
          foundOffset = searchWindow.toLowerCase().indexOf(original.toLowerCase());
        }
        
        if (foundOffset !== -1) {
          start = windowStart + foundOffset;
          end = start + original.length;
        } else {
          // If not in nearby window, fallback to global text search
          let globalIdx = text.indexOf(original);
          if (globalIdx === -1) {
            globalIdx = text.toLowerCase().indexOf(original.toLowerCase());
          }
          if (globalIdx !== -1) {
            start = globalIdx;
            end = globalIdx + original.length;
          }
        }
      }
      
      return {
        ...error,
        startIndex: start,
        endIndex: end
      };
    });
  }, [activeErrors, currentPageData.verbatim]);

  const renderVerbatim = () => {
    const text = currentPageData.verbatim;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    // Sort errors by start index to process sequentially and avoid overlap rendering bugs
    const sortedActiveErrors = [...alignedActiveErrors].sort((a, b) => a.startIndex - b.startIndex);

    sortedActiveErrors.forEach((error) => {
      // Add text before the error
      if (error.startIndex > lastIndex) {
        elements.push(text.slice(lastIndex, error.startIndex));
      }

      // Safeguard: make sure we highlight something and ignore invalid negative or completely broken bounds
      if (error.startIndex >= lastIndex && error.endIndex > error.startIndex && error.endIndex <= text.length) {
        elements.push(
          <motion.span
            key={`error-${error.id}`}
            initial={{ backgroundColor: 'rgba(255, 255, 255, 0)' }}
            animate={{ backgroundColor: error.type === 'ortografía' ? '#fee2e2' : error.type === 'gramática' ? '#fef3c7' : '#e0f2fe' }}
            className={cn(
              "px-1 rounded border-b-2 cursor-help transition-all duration-300",
              error.type === 'ortografía' ? "border-rose-400" : error.type === 'gramática' ? "border-amber-400" : "border-sky-400"
            )}
            title={error.explanation}
          >
            {text.slice(error.startIndex, error.endIndex)}
          </motion.span>
        );
        lastIndex = error.endIndex;
      } else if (error.startIndex >= lastIndex && error.startIndex < text.length) {
        // If endIndex is somehow misaligned or smaller, just render standard highlight for the original token length
        const safeEnd = Math.min(text.length, error.startIndex + (error.original?.length || 1));
        elements.push(
          <motion.span
            key={`error-${error.id}`}
            initial={{ backgroundColor: 'rgba(255, 255, 255, 0)' }}
            animate={{ backgroundColor: error.type === 'ortografía' ? '#fee2e2' : error.type === 'gramática' ? '#fef3c7' : '#e0f2fe' }}
            className={cn(
              "px-1 rounded border-b-2 cursor-help transition-all duration-300",
              error.type === 'ortografía' ? "border-rose-400" : error.type === 'gramática' ? "border-amber-400" : "border-sky-400"
            )}
            title={error.explanation}
          >
            {text.slice(error.startIndex, safeEnd)}
          </motion.span>
        );
        lastIndex = safeEnd;
      }
    });

    // Add remaining text
    if (lastIndex < text.length) {
      elements.push(text.slice(lastIndex));
    }

    return elements;
  };

  return (
    <div className="lg:flex-1 lg:flex lg:flex-col gap-6 lg:min-h-0 lg:h-full pb-6">
      {/* Persistent Compact Header */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 md:px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 md:gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2.5 h-2.5 rounded-full",
              calculatedScore > 80 ? "bg-emerald-500" : calculatedScore > 50 ? "bg-amber-500" : "bg-rose-500"
            )} />
            <span className="text-xs font-black text-slate-800 uppercase tracking-widest">Puntuación: {calculatedScore}%</span>
          </div>
          
          <div className="h-4 w-px bg-slate-200 hidden sm:block" />
          
          <div className="flex items-center gap-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <span>Activos: <strong className="text-slate-800">{activeErrors.length}</strong></span>
            <span className="w-1 h-1 bg-slate-300 rounded-full" />
            <span>Palabras: <strong className="text-slate-800">{currentPageData.verbatim.split(/\s+/).filter(Boolean).length}</strong></span>
            {ignoredIds.size > 0 && (
              <>
                <span className="w-1 h-1 bg-slate-300 rounded-full" />
                <span>Ignorados: <strong className="text-amber-600">{ignoredIds.size}</strong></span>
              </>
            )}
          </div>
          
          <div className="h-4 w-px bg-slate-200 hidden md:block" />
          
          <p className="text-xs italic text-slate-500 max-w-[300px] truncate hidden lg:block" title={result.summary}>
            "{result.summary}"
          </p>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onExport}
            className="text-[10px] font-black uppercase tracking-widest text-white bg-red-600 hover:bg-red-700 flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg transition-colors shadow-sm cursor-pointer"
            title="Exportar Reporte Completo en PDF"
          >
            <Download className="w-3.5 h-3.5" /> Exportar Reporte
          </button>
        </div>
      </div>

      {/* Scalable Pagination Controls for Large Documents */}
      {result.pages && result.pages.length > 1 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 transition-all">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button
              onClick={() => setActivePageIndex('all')}
              className={cn(
                "px-3.5 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border transition-all cursor-pointer flex items-center gap-1.5",
                activePageIndex === 'all'
                  ? "bg-slate-900 border-slate-950 text-white shadow-sm"
                  : "bg-white border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300"
              )}
            >
              <FileText className="w-3.5 h-3.5" /> Todo junto
            </button>

            <div className="h-6 w-px bg-slate-200 hidden md:block" />

            {/* Quick jump dropdown selector */}
            <div className="relative flex-1 md:flex-none">
              <select
                value={activePageIndex}
                onChange={(e) => {
                  const val = e.target.value;
                  setActivePageIndex(val === 'all' ? 'all' : parseInt(val, 10));
                }}
                className="w-full md:w-56 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-all cursor-pointer"
              >
                <option value="all">Documento Completo (Todas las pág.)</option>
                {result.pages.map((p, idx) => (
                  <option key={`opt-${idx}`} value={idx}>
                    {p.name} ({p.errors.length} {p.errors.length === 1 ? 'error' : 'errores'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Page Indicators & Sequential Navigators */}
          <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
            <div className="flex items-center gap-1">
              <button
                disabled={activePageIndex === 'all' || activePageIndex === 0}
                onClick={() => {
                  if (activePageIndex !== 'all' && activePageIndex > 0) {
                    setActivePageIndex(activePageIndex - 1);
                  }
                }}
                className={cn(
                  "p-2 rounded-lg border transition-all cursor-pointer",
                  activePageIndex === 'all' || activePageIndex === 0
                    ? "bg-slate-100 border-slate-100 text-slate-300 cursor-not-allowed"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                )}
                title="Página Anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Dynamic desktop page number selector buttons */}
              <div className="hidden sm:flex items-center gap-1 mx-1">
                {(() => {
                  const currentIdx = activePageIndex === 'all' ? -1 : activePageIndex;
                  const total = result.pages.length;
                  
                  // Helper logic to build standard smart pagination slider
                  const range: Array<number | 'dots'> = [];
                  const delta = 1;
                  
                  range.push(0);
                  if (currentIdx - delta > 1) {
                    range.push('dots');
                  }
                  
                  const start = Math.max(1, currentIdx - delta);
                  const end = Math.min(total - 2, currentIdx + delta);
                  for (let i = start; i <= end; i++) {
                    range.push(i);
                  }
                  
                  if (currentIdx + delta < total - 2) {
                    range.push('dots');
                  }
                  
                  if (total > 1) {
                    range.push(total - 1);
                  }

                  return range.map((item, idx) => {
                    if (item === 'dots') {
                      return (
                        <span key={`dots-${idx}`} className="px-2 text-slate-400 text-xs font-bold">
                          ...
                        </span>
                      );
                    }
                    return (
                      <button
                        key={`pg-${item}`}
                        onClick={() => setActivePageIndex(item)}
                        className={cn(
                          "w-8 h-8 flex items-center justify-center text-xs font-black rounded-lg border transition-all cursor-pointer",
                          activePageIndex === item
                            ? "bg-amber-500 border-amber-600 text-white shadow-sm"
                            : "bg-white border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300"
                        )}
                      >
                        {item + 1}
                      </button>
                    );
                  });
                })()}
              </div>

              {/* Mobile current indicator */}
              <span className="text-xs font-black text-slate-500 uppercase tracking-wider px-3 sm:hidden">
                {activePageIndex === 'all' ? 'Todo' : `${activePageIndex + 1} / ${result.pages.length}`}
              </span>

              <button
                disabled={activePageIndex === 'all' || activePageIndex === result.pages.length - 1}
                onClick={() => {
                  if (activePageIndex === 'all') {
                    setActivePageIndex(0);
                  } else if (activePageIndex < result.pages.length - 1) {
                    setActivePageIndex(activePageIndex + 1);
                  }
                }}
                className={cn(
                  "p-2 rounded-lg border transition-all cursor-pointer",
                  activePageIndex === 'all' || activePageIndex === result.pages.length - 1
                    ? "bg-slate-100 border-slate-100 text-slate-300 cursor-not-allowed"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                )}
                title="Siguiente Página"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Analysis Grid */}
      <div className="grid grid-cols-12 gap-4 md:gap-6 lg:gap-8 lg:flex-1 lg:min-h-0 lg:h-full">
        {/* Left Pane: Literal Transcription */}
        <section className="col-span-12 lg:col-span-7 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Transcripción Literal del Original</span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse"></span>
                <span className="text-[10px] text-slate-400 font-bold uppercase italic tracking-tighter">Sin filtros de corrección</span>
              </div>
            </div>
          </div>
          <div 
            className="flex-1 p-5 md:p-10 font-serif text-lg md:text-xl leading-[2] text-slate-700 paper-dots overflow-y-auto whitespace-pre-wrap selection:bg-amber-100"
          >
            {renderVerbatim()}
          </div>
        </section>

        {/* Right Pane: Analysis & Error Log */}
        <section className="col-span-12 lg:col-span-5 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <h2 className="text-[10px] font-black uppercase tracking-wider text-slate-500">Detalles de Correcciones</h2>
            {ignoredIds.size > 0 && (
              <button 
                onClick={() => setIgnoredIds(new Set())}
                className="text-[9px] font-bold uppercase tracking-widest text-amber-700 hover:text-amber-800"
              >
                Restaurar All
              </button>
            )}
          </div>
          <div 
            className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar"
          >
            <AnimatePresence>
              {currentPageData.errors.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4 opacity-50">
                  <CheckCircle2 className="w-12 h-12" />
                  <p className="font-bold uppercase tracking-widest text-[10px]">No se encontraron errores</p>
                </div>
              ) : (
                currentPageData.errors.map((error, idx) => (
                  <motion.div 
                    key={error.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: ignoredIds.has(error.id) ? 0.5 : 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className={cn(
                      "p-4 border rounded-lg group transition-all duration-300 relative",
                      ignoredIds.has(error.id) ? "bg-slate-50 border-slate-100" : "bg-white border-slate-200 hover:border-amber-200 shadow-sm"
                    )}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded",
                        error.type === 'ortografía' ? "bg-rose-100 text-rose-600" : 
                        error.type === 'gramática' ? "bg-amber-100 text-amber-600" : 
                        "bg-sky-100 text-sky-600"
                      )}>
                        {error.type}
                      </span>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => toggleIgnore(error.id)}
                          className={cn(
                            "p-1.5 rounded-md hover:bg-slate-100 transition-colors",
                            ignoredIds.has(error.id) ? "text-amber-700 bg-amber-50" : "text-slate-300"
                          )}
                          title={ignoredIds.has(error.id) ? "Mostrar" : "Ignorar"}
                        >
                          {ignoredIds.has(error.id) ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <AlertCircle className="w-3.5 h-3.5 text-slate-300" />
                      </div>
                    </div>
                    
                    {!ignoredIds.has(error.id) && (
                      <>
                        <div className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1 mb-3">
                          <span className="text-xs md:text-sm font-bold text-rose-500 font-serif line-through decoration-slate-400 decoration-2 break-all">
                             {error.original}
                          </span>
                          <span className="text-slate-300 text-xs font-bold">→</span>
                          <span className="text-xs md:text-sm font-bold text-emerald-600 font-serif bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 break-all">
                             {error.corrected}
                          </span>
                        </div>
                        
                        <div className="text-[11px] text-slate-500 leading-relaxed font-medium">
                          <ReactMarkdown>{error.explanation}</ReactMarkdown>
                        </div>
                      </>
                    )}
                    {ignoredIds.has(error.id) && (
                      <div className="text-[10px] text-slate-400 font-bold uppercase italic tracking-widest">
                        Error ignorado
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>
    </div>
  );
}


const FileText = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);



