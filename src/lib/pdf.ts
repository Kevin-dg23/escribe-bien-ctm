import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AnalysisResult } from './gemini';

export function downloadAnalysisPDF(result: AnalysisResult, fileName: string | null) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // ----- PAGE 1: GLOBAL OVERVIEW -----
  // Header
  doc.setFontSize(22);
  doc.setTextColor(220, 38, 38); // red-600
  doc.text('Escribe Bien CTM', 14, 22);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Reporte de Análisis Ortográfico • ${new Date().toLocaleDateString()}`, 14, 30);
  if (fileName) {
    doc.text(`Archivo: ${fileName}`, 14, 35);
  }

  // Summary
  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text('Resumen General de Diagnóstico', 14, 45);
  
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text(`Puntuación Global de Exactitud: ${result.score}%`, 14, 52);
  doc.text(`Total Errores detectóados: ${result.errors.length}`, 14, 57);
  if (result.pages && result.pages.length > 1) {
    doc.text(`Hojas/Imágenes Analizadas: ${result.pages.length}`, 14, 62);
  }
  
  const splitSummary = doc.splitTextToSize(result.summary, pageWidth - 28);
  doc.text(splitSummary, 14, 70);

  let currentY = 70 + (splitSummary.length * 5) + 15;

  if (!result.pages || result.pages.length <= 1) {
    // Single page output layout
    // Verbatim Text
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text('Transcripción Literal', 14, currentY);
    
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const splitVerbatim = doc.splitTextToSize(result.verbatim, pageWidth - 28);
    
    doc.setFont('courier');
    doc.text(splitVerbatim, 14, currentY + 8);
    doc.setFont('helvetica');

    currentY = currentY + 8 + (splitVerbatim.length * 4.5) + 15;

    // Errors Table
    if (result.errors.length > 0) {
      if (currentY > pageHeight - 40) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text('Detalle de Errores', 14, currentY);

      const tableData = result.errors.map(error => [
        error.type.toUpperCase(),
        error.original,
        error.corrected,
        error.explanation
      ]);

      autoTable(doc, {
        startY: currentY + 5,
        head: [['Tipo', 'Original', 'Corrección', 'Explicación']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [220, 38, 38] },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 'auto' }
          }
      });
    }
  } else {
    // Multi-page paginated output layout
    const pagesWithErrors = result.pages.filter(p => p.errors && p.errors.length > 0);
    
    if (pagesWithErrors.length === 0) {
      doc.setFontSize(14);
      doc.setTextColor(34, 197, 94); // emerald-500
      doc.text('¡¡Excelente! No se encontraron errores en ninguna de las páginas analizadas.', 14, currentY + 20);
    }

    pagesWithErrors.forEach((page, index) => {
      // Add page break for every page EXCEPT the very first one IF we are already at the top
      if (index > 0 || currentY > pageHeight - 60) {
        doc.addPage();
        currentY = 20;
      } else {
        currentY += 10;
      }
      
      // Page Sub-header
      doc.setFontSize(16);
      doc.setTextColor(220, 38, 38);
      doc.text(`${page.name}`, 14, currentY);
      
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Exactitud: ${page.score}% • Errores: ${page.errors.length}`, 14, currentY + 6);
      
      // Line separator
      doc.setDrawColor(226, 232, 240);
      doc.line(14, currentY + 10, pageWidth - 14, currentY + 10);
      
      currentY += 18;

      // Verbatim text using autoTable to guarantee proper page breaks
      autoTable(doc, {
        startY: currentY,
        head: [['Transcripción de la hoja']],
        body: [[page.verbatim || "(Vacío)"]],
        theme: 'plain',
        headStyles: { 
          fillColor: [248, 250, 252], 
          textColor: [30, 41, 59], 
          fontStyle: 'bold', 
          fontSize: 11 
        },
        bodyStyles: { 
          font: 'courier', 
          textColor: [71, 85, 105], 
          fontSize: 8 
        },
        margin: { left: 14, right: 14 },
      });

      currentY = (doc as any).lastAutoTable.finalY + 10;

      // Errors specific to this page
      if (page.errors.length > 0) {
        const pageTableData = page.errors.map(error => [
          error.type ? error.type.toUpperCase() : 'GENERAL',
          error.original || ' ',
          error.corrected || ' ',
          error.explanation || ' '
        ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Tipo', 'Original', 'Corrección', 'Explicación']],
          body: pageTableData,
          theme: 'striped',
          headStyles: { fillColor: [220, 38, 38] },
          styles: { fontSize: 8, cellPadding: 3 },
          columnStyles: {
            0: { cellWidth: 22 },
            1: { cellWidth: 35 },
            2: { cellWidth: 35 },
            3: { cellWidth: 'auto' }
          },
          margin: { left: 14, right: 14 }
        });
        
        currentY = (doc as any).lastAutoTable.finalY + 15;
      }
    });
  }

  doc.save(`analisis_ortografico_${fileName?.replace(/\.[^/.]+$/, "") || 'documento'}.pdf`);
}


