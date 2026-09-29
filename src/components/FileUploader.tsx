import { useState, useRef } from 'react';
import { Upload, FileText, Image as ImageIcon, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface FileUploaderProps {
  onFileSelect: (files: File[], mode: 'image' | 'digital-pdf' | 'scanned-pdf') => void;
  disabled?: boolean;
  title: string;
  description: string;
  accept?: string;
  icon?: React.ReactNode;
  mode: 'image' | 'digital-pdf' | 'scanned-pdf';
}

export default function FileUploader({ 
  onFileSelect, 
  disabled, 
  title, 
  description, 
  accept = "image/*,.pdf",
  icon,
  mode
}: FileUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const descriptionId = `uploader-description-${mode}`;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;

    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const isImageFile = (file: File) =>
    file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      if (mode === 'image') {
        const imageFiles = filesArray.filter(isImageFile);
        if (imageFiles.length > 0) {
          onFileSelect(imageFiles, mode);
        }
      } else if (filesArray[0]) {
        onFileSelect([filesArray[0]], mode);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (disabled) return;

    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      if (mode === 'image') {
        const imageFiles = filesArray.filter(isImageFile);
        if (imageFiles.length > 0) {
          onFileSelect(imageFiles, mode);
        }
      } else if (filesArray[0]) {
        onFileSelect([filesArray[0]], mode);
      }
    }

    e.target.value = '';
  };

  const openFilePicker = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  return (
    <div className="w-full h-full">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={mode === 'image'}
        onChange={handleChange}
        tabIndex={-1}
        aria-hidden="true"
      />

      <button
        type="button"
        disabled={disabled}
        aria-label={`Seleccionar ${title}`}
        aria-describedby={descriptionId}
        className={cn(
          "relative h-full w-full min-h-[190px] flex flex-col group cursor-pointer border border-slate-200 rounded-xl p-5 md:p-8 transition-all duration-300 text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400/35 focus-visible:border-red-500",
          dragActive ? "border-red-500 bg-red-50/30" : "bg-white hover:border-slate-300 shadow-sm hover:shadow-md",
          disabled && "opacity-50 cursor-not-allowed pointer-events-none"
        )}
        onClick={openFilePicker}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center space-y-4 flex-1 w-full">
          <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform duration-300 shadow-sm">
            {icon || <Upload className="w-5 h-5 text-red-500" />}
          </div>
          <div className="text-center space-y-1">
            <p className="text-base font-bold text-slate-800 uppercase tracking-tight">
              {title}
            </p>
            <p id={descriptionId} className="text-[10px] font-bold text-slate-400 uppercase tracking-widest line-clamp-2">
              {description}
            </p>
          </div>
        </div>
      </button>
    </div>
  );
}
