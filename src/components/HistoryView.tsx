import React from 'react';
import { Clock, Trash2, ChevronRight, FileText, FileImage } from 'lucide-react';
import { AnalysisResult } from '../lib/gemini';
import { motion } from 'motion/react';

interface HistoryItem {
  id: string;
  date: number;
  fileName: string;
  score: number;
  errors: number;
  result: AnalysisResult;
}

interface HistoryViewProps {
  history: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onClear: () => void;
}

export default function HistoryView({ history, onSelect, onClear }: HistoryViewProps) {
  if (history.length === 0) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
        className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4"
      >
        <Clock className="w-12 h-12 opacity-20" />
        <p className="text-sm font-medium">Aún no hay análisis en tu historial</p>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      className="max-w-4xl mx-auto w-full space-y-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black tracking-tight text-slate-800 flex items-center gap-2">
          <Clock className="w-6 h-6 text-red-600" />
          Historial de Análisis
        </h2>
        <button 
          onClick={onClear}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors uppercase tracking-widest"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Limpiar Todo
        </button>
      </div>

      <div className="grid gap-3">
        {history.map((item) => {
          const isImage = item.fileName.toLowerCase().match(/\.(png|jpe?g)$/) || item.fileName.includes('imagen');
          
          return (
            <div 
              key={item.id} 
              onClick={() => onSelect(item)}
              className="group flex items-center justify-between p-4 bg-white border border-slate-200 rounded-2xl hover:border-red-200 hover:shadow-md transition-all cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${isImage ? 'bg-indigo-50 text-indigo-500' : 'bg-emerald-50 text-emerald-500'}`}>
                  {isImage ? <FileImage className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 line-clamp-1 group-hover:text-red-600 transition-colors">
                    {item.fileName}
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      {new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-slate-200" />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${item.errors === 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {item.errors} {item.errors === 1 ? 'error' : 'errores'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right hidden sm:block">
                  <div className="text-2xl font-black tracking-tighter" style={{ color: item.score >= 90 ? '#10b981' : item.score >= 70 ? '#f59e0b' : '#ef4444' }}>
                    {item.score}<span className="text-sm text-slate-400 font-bold">%</span>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-red-50 group-hover:text-red-600 transition-colors text-slate-400">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
