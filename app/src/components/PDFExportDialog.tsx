// ─── PDFExportDialog.tsx ── PDF Export for Schematic & Board ─────────────────
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { theme } from '../styles/theme';
import { useProjectStore } from '../store/projectStore';
import type { ProjectMetadata } from '../store/projectStore';

// ─── Types ──────────────────────────────────────────────────────────────────

type PageSize = 'A4' | 'A3' | 'Letter' | 'Legal';
type Orientation = 'landscape' | 'portrait';
type ScaleMode = 'fit' | '1:1' | 'custom';
type ColorMode = 'color' | 'bw';

interface PDFExportOptions {
  pageSize: PageSize;
  orientation: Orientation;
  exportSchematic: boolean;
  exportBoard: boolean;
  titleBlock: TitleBlockInfo;
  scaleMode: ScaleMode;
  customScale: number;
  colorMode: ColorMode;
  includeBOM: boolean;
}

interface TitleBlockInfo {
  projectName: string;
  date: string;
  revision: string;
  author: string;
  company: string;
}

// ─── Page dimensions in mm ──────────────────────────────────────────────────

const PAGE_SIZES: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  Letter: { w: 215.9, h: 279.4 },
  Legal: { w: 215.9, h: 355.6 },
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface PDFExportDialogProps {
  open: boolean;
  onClose: () => void;
}

// ─── Overlay & Dialog styles (match SettingsDialog pattern) ─────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 5000,
};

const dialogStyle: React.CSSProperties = {
  background: theme.bg1,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '10px',
  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  width: '720px',
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: theme.fontSans,
  color: theme.textPrimary,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 20px',
  borderBottom: `1px solid ${theme.bg3}`,
  flexShrink: 0,
};

const bodyStyle: React.CSSProperties = {
  padding: '20px',
  overflowY: 'auto',
  flex: 1,
  display: 'flex',
  gap: '20px',
};

const columnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
};

const sectionStyle: React.CSSProperties = {
  background: theme.bg2,
  borderRadius: '6px',
  padding: '12px 14px',
  border: `1px solid ${theme.bg3}`,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: theme.textSecondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  marginBottom: '10px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: theme.textSecondary,
  marginBottom: '4px',
  display: 'block',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  background: theme.bg0,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '4px',
  color: theme.textPrimary,
  fontSize: '12px',
  fontFamily: theme.fontSans,
  outline: 'none',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  background: theme.bg0,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '4px',
  color: theme.textPrimary,
  fontSize: '12px',
  fontFamily: theme.fontSans,
  outline: 'none',
  boxSizing: 'border-box' as const,
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '12px',
  color: theme.textPrimary,
  cursor: 'pointer',
};

const radioRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  alignItems: 'center',
};

const radioLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  fontSize: '12px',
  color: theme.textPrimary,
  cursor: 'pointer',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '10px',
  padding: '14px 20px',
  borderTop: `1px solid ${theme.bg3}`,
  flexShrink: 0,
};

const btnPrimaryStyle: React.CSSProperties = {
  padding: '8px 20px',
  background: theme.blue,
  color: '#fff',
  border: 'none',
  borderRadius: '5px',
  fontSize: '12px',
  fontWeight: 600,
  fontFamily: theme.fontSans,
  cursor: 'pointer',
  transition: 'background 0.12s',
};

const btnSecondaryStyle: React.CSSProperties = {
  padding: '8px 20px',
  background: 'transparent',
  color: theme.textSecondary,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '5px',
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: theme.fontSans,
  cursor: 'pointer',
  transition: 'all 0.12s',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: theme.textMuted,
  fontSize: '18px',
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
};

const previewBoxStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '1.414 / 1',
  background: '#ffffff',
  borderRadius: '4px',
  border: `1px solid ${theme.bg3}`,
  position: 'relative',
  overflow: 'hidden',
};

const statusStyle: React.CSSProperties = {
  fontSize: '11px',
  color: theme.textMuted,
  textAlign: 'center' as const,
  marginTop: '6px',
};

// ─── Title Block Drawing Helpers ────────────────────────────────────────────

function mmToPt(mm: number): number {
  return mm * 72 / 25.4;
}

interface TitleBlockRect {
  x: number; // pt from left
  y: number; // pt from top
  w: number; // pt
  h: number; // pt
}

function computeDrawingArea(
  pageSize: PageSize,
  orientation: Orientation,
): { pageW: number; pageH: number; margin: number; titleBlockH: number; drawArea: TitleBlockRect } {
  const raw = PAGE_SIZES[pageSize];
  const pageW = mmToPt(orientation === 'landscape' ? raw.h : raw.w);
  const pageH = mmToPt(orientation === 'landscape' ? raw.w : raw.h);
  const margin = mmToPt(10);
  const titleBlockH = mmToPt(20);
  const drawArea: TitleBlockRect = {
    x: margin,
    y: margin,
    w: pageW - 2 * margin,
    h: pageH - 2 * margin - titleBlockH,
  };
  return { pageW, pageH, margin, titleBlockH, drawArea };
}

// ─── SVG Content Bounds Calculator ──────────────────────────────────────────

function getSVGContentBounds(svg: SVGSVGElement): { minX: number; minY: number; maxX: number; maxY: number } | null {
  // Find the main content group (first <g> with transform containing scale)
  const groups = svg.querySelectorAll('g[transform]');
  let contentGroup: SVGGElement | null = null;
  for (const g of Array.from(groups)) {
    const t = g.getAttribute('transform') || '';
    if (t.includes('scale')) {
      contentGroup = g as SVGGElement;
      break;
    }
  }

  if (!contentGroup) return null;

  try {
    const bbox = contentGroup.getBBox();
    if (bbox.width === 0 && bbox.height === 0) return null;
    return {
      minX: bbox.x,
      minY: bbox.y,
      maxX: bbox.x + bbox.width,
      maxY: bbox.y + bbox.height,
    };
  } catch {
    return null;
  }
}

// ─── Clone SVG for PDF export ───────────────────────────────────────────────

function cloneSVGForExport(
  originalSvg: SVGSVGElement,
  colorMode: ColorMode,
): { svgClone: SVGSVGElement; bounds: { minX: number; minY: number; maxX: number; maxY: number } } | null {
  const bounds = getSVGContentBounds(originalSvg);
  if (!bounds) return null;

  // Add padding around content
  const pad = 10; // mm
  const vbX = bounds.minX - pad;
  const vbY = bounds.minY - pad;
  const vbW = (bounds.maxX - bounds.minX) + 2 * pad;
  const vbH = (bounds.maxY - bounds.minY) + 2 * pad;

  const clone = originalSvg.cloneNode(true) as SVGSVGElement;

  // Set viewBox to content bounds
  clone.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  clone.removeAttribute('width');
  clone.removeAttribute('height');

  // Remove grid background (patterns and grid rects)
  const patterns = clone.querySelectorAll('pattern');
  patterns.forEach(p => p.remove());
  const gridRects = clone.querySelectorAll('rect[fill*="url(#"]');
  gridRects.forEach(r => r.remove());

  // Set white background for PDF
  clone.style.background = '#ffffff';

  // Remove event handler attributes
  clone.removeAttribute('onmousedown');
  clone.removeAttribute('onmousemove');
  clone.removeAttribute('onmouseup');
  clone.removeAttribute('onwheel');
  clone.removeAttribute('oncontextmenu');

  // Remove the viewport transform from the content group - reset to identity
  const groups = clone.querySelectorAll('g[transform]');
  for (const g of Array.from(groups)) {
    const t = g.getAttribute('transform') || '';
    if (t.includes('translate') && t.includes('scale')) {
      // This is the main viewport transform group - remove the viewport transform
      // Keep the group but set transform to none (content is in schematic coords)
      g.setAttribute('transform', '');
      break;
    }
  }

  // B&W mode: convert all colors to grayscale
  if (colorMode === 'bw') {
    convertToGrayscale(clone);
  }

  return { svgClone: clone, bounds: { minX: vbX, minY: vbY, maxX: vbX + vbW, maxY: vbY + vbH } };
}

function convertToGrayscale(el: Element): void {
  // Add a CSS filter for grayscale
  if (el instanceof SVGElement) {
    const style = el.getAttribute('style') || '';
    if (el === el.ownerDocument?.documentElement || el.tagName === 'svg') {
      el.setAttribute('style', style + '; filter: grayscale(100%);');
    }
  }
  // Recursively process color attributes
  const colorAttrs = ['fill', 'stroke', 'color', 'stop-color'];
  for (const attr of colorAttrs) {
    const val = el.getAttribute(attr);
    if (val && val !== 'none' && val !== 'transparent' && !val.startsWith('url(')) {
      el.setAttribute(attr, colorToGray(val));
    }
  }
  for (const child of Array.from(el.children)) {
    convertToGrayscale(child);
  }
}

function colorToGray(color: string): string {
  // Parse hex colors
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let r: number, g: number, b: number;
    const h = hex[1];
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else if (h.length >= 6) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    } else {
      return color;
    }
    // Luminance formula
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const gh = gray.toString(16).padStart(2, '0');
    return `#${gh}${gh}${gh}`;
  }

  // Parse rgb/rgba
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const gray = Math.round(0.299 * +rgb[1] + 0.587 * +rgb[2] + 0.114 * +rgb[3]);
    return `rgb(${gray},${gray},${gray})`;
  }

  return color;
}

// ─── PDF Generation ─────────────────────────────────────────────────────────

async function generatePDF(options: PDFExportOptions): Promise<void> {
  // Dynamic imports so the bundle only loads when user exports
  const { jsPDF } = await import('jspdf');
  await import('svg2pdf.js');

  const { pageSize, orientation, exportSchematic, exportBoard,
          titleBlock, scaleMode, customScale, colorMode, includeBOM } = options;

  const raw = PAGE_SIZES[pageSize];
  const pdfW = orientation === 'landscape' ? raw.h : raw.w;
  const pdfH = orientation === 'landscape' ? raw.w : raw.h;

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: [pdfW, pdfH],
  });

  let pageNum = 0;

  // ── Export Schematic (SVG-based, vector) ──────────────────────────────
  if (exportSchematic) {
    const svgEl = document.querySelector('.schematic-editor-container svg') as SVGSVGElement | null;
    if (svgEl) {
      if (pageNum > 0) pdf.addPage([pdfW, pdfH], orientation);
      pageNum++;

      const result = cloneSVGForExport(svgEl, colorMode);
      if (result) {
        const { svgClone, bounds } = result;
        const contentW = bounds.maxX - bounds.minX;
        const contentH = bounds.maxY - bounds.minY;

        // Compute drawing area (inside margins, above title block)
        const margin = 10; // mm
        const titleH = 20; // mm
        const drawW = pdfW - 2 * margin;
        const drawH = pdfH - 2 * margin - titleH;

        // Compute scale
        let scale = 1;
        if (scaleMode === 'fit') {
          const sx = drawW / contentW;
          const sy = drawH / contentH;
          scale = Math.min(sx, sy);
        } else if (scaleMode === '1:1') {
          scale = 1;
        } else {
          scale = customScale;
        }

        const renderW = contentW * scale;
        const renderH = contentH * scale;

        // Center content within drawing area
        const xOffset = margin + (drawW - renderW) / 2;
        const yOffset = margin + (drawH - renderH) / 2;

        // Set SVG dimensions to match output size
        svgClone.setAttribute('width', `${renderW}mm`);
        svgClone.setAttribute('height', `${renderH}mm`);

        // Temporarily add to DOM for svg2pdf to work
        svgClone.style.position = 'absolute';
        svgClone.style.left = '-9999px';
        svgClone.style.top = '-9999px';
        document.body.appendChild(svgClone);

        try {
          // svg2pdf.js adds the svg2pdf method to jsPDF
          await (pdf as any).svg(svgClone, {
            x: xOffset,
            y: yOffset,
            width: renderW,
            height: renderH,
          });
        } catch (err) {
          console.warn('svg2pdf vector export failed, falling back to raster:', err);
          // Fallback: capture SVG as image via serialization
          try {
            const html2canvas = (await import('html2canvas')).default;
            const canvas = await html2canvas(svgEl.parentElement || svgEl as any, {
              backgroundColor: '#ffffff',
              scale: 2,
            });
            const imgData = canvas.toDataURL('image/png');
            pdf.addImage(imgData, 'PNG', xOffset, yOffset, renderW, renderH);
          } catch (err2) {
            console.error('Raster fallback also failed:', err2);
          }
        } finally {
          document.body.removeChild(svgClone);
        }
      }

      // Draw title block and border for schematic page
      drawPageBorder(pdf, pdfW, pdfH);
      drawTitleBlock(pdf, pdfW, pdfH, titleBlock, pageNum, 'Schematic');
    }
  }

  // ── Export Board (Canvas 2D-based, raster) ────────────────────────────
  if (exportBoard) {
    const boardCanvas = document.querySelector('.board-editor-container canvas') as HTMLCanvasElement | null;
    if (boardCanvas) {
      if (pageNum > 0) pdf.addPage([pdfW, pdfH], orientation);
      pageNum++;

      const margin = 10;
      const titleH = 20;
      const drawW = pdfW - 2 * margin;
      const drawH = pdfH - 2 * margin - titleH;

      // Get canvas image data
      const imgData = boardCanvas.toDataURL('image/png', 1.0);

      // Calculate aspect-preserving dimensions
      const canvasAspect = boardCanvas.width / boardCanvas.height;
      const drawAspect = drawW / drawH;

      let renderW: number, renderH: number;
      if (canvasAspect > drawAspect) {
        renderW = drawW;
        renderH = drawW / canvasAspect;
      } else {
        renderH = drawH;
        renderW = drawH * canvasAspect;
      }

      const xOffset = margin + (drawW - renderW) / 2;
      const yOffset = margin + (drawH - renderH) / 2;

      // Apply B&W if needed
      if (colorMode === 'bw') {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = boardCanvas.width;
        tempCanvas.height = boardCanvas.height;
        const ctx = tempCanvas.getContext('2d')!;
        ctx.drawImage(boardCanvas, 0, 0);
        const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
          d[i] = gray;
          d[i + 1] = gray;
          d[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);
        const bwImg = tempCanvas.toDataURL('image/png', 1.0);
        pdf.addImage(bwImg, 'PNG', xOffset, yOffset, renderW, renderH);
      } else {
        pdf.addImage(imgData, 'PNG', xOffset, yOffset, renderW, renderH);
      }

      drawPageBorder(pdf, pdfW, pdfH);
      drawTitleBlock(pdf, pdfW, pdfH, titleBlock, pageNum, 'Board Layout');
    }
  }

  // ── BOM Page ──────────────────────────────────────────────────────────
  if (includeBOM) {
    if (pageNum > 0) pdf.addPage([pdfW, pdfH], orientation);
    pageNum++;

    drawPageBorder(pdf, pdfW, pdfH);
    drawTitleBlock(pdf, pdfW, pdfH, titleBlock, pageNum, 'Bill of Materials');
    drawBOMTable(pdf, pdfW, pdfH);
  }

  // ── Save ──────────────────────────────────────────────────────────────
  if (pageNum === 0) {
    alert('Nothing to export. Select at least one content option.');
    return;
  }

  const filename = `${titleBlock.projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${titleBlock.date}.pdf`;
  pdf.save(filename);
}

// ─── Drawing Helpers ────────────────────────────────────────────────────────

function drawPageBorder(pdf: any, pdfW: number, pdfH: number): void {
  const m = 5; // 5mm margin for outer border
  pdf.setDrawColor(40, 40, 50);
  pdf.setLineWidth(0.5);
  pdf.rect(m, m, pdfW - 2 * m, pdfH - 2 * m);

  // Inner border (drawing area)
  const m2 = 10;
  pdf.setDrawColor(80, 80, 100);
  pdf.setLineWidth(0.2);
  pdf.rect(m2, m2, pdfW - 2 * m2, pdfH - 2 * m2);
}

function drawTitleBlock(
  pdf: any,
  pdfW: number,
  pdfH: number,
  info: TitleBlockInfo,
  pageNum: number,
  sheetTitle: string,
): void {
  const m = 10; // inner margin
  const tbH = 20; // title block height in mm
  const tbY = pdfH - m - tbH;
  const tbW = pdfW - 2 * m;

  // Title block background
  pdf.setFillColor(245, 245, 248);
  pdf.setDrawColor(60, 60, 80);
  pdf.setLineWidth(0.3);
  pdf.rect(m, tbY, tbW, tbH, 'FD');

  // Vertical dividers
  const col1 = m + tbW * 0.35;
  const col2 = m + tbW * 0.60;
  const col3 = m + tbW * 0.80;
  pdf.setLineWidth(0.15);
  pdf.line(col1, tbY, col1, tbY + tbH);
  pdf.line(col2, tbY, col2, tbY + tbH);
  pdf.line(col3, tbY, col3, tbY + tbH);

  // Horizontal divider
  const midY = tbY + tbH / 2;
  pdf.line(m, midY, m + tbW, midY);

  // Text styling
  pdf.setTextColor(30, 30, 40);

  // Project name (large, top-left cell)
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text(info.projectName, m + 3, tbY + 7);

  // Sheet title below project name
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.text(sheetTitle, m + 3, tbY + 14);

  // Company (top-left, bottom row)
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'italic');
  pdf.text(info.company || '', m + 3, tbY + 18.5);

  // Author (top-right of col1)
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 100);
  pdf.text('Author:', col1 + 3, tbY + 4);
  pdf.setTextColor(30, 30, 40);
  pdf.setFont('helvetica', 'bold');
  pdf.text(info.author, col1 + 3, tbY + 8.5);

  // Date
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 100);
  pdf.text('Date:', col1 + 3, tbY + 13.5);
  pdf.setTextColor(30, 30, 40);
  pdf.text(info.date, col1 + 3, tbY + 18);

  // Revision
  pdf.setTextColor(80, 80, 100);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Revision:', col2 + 3, tbY + 4);
  pdf.setTextColor(30, 30, 40);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text(info.revision, col2 + 3, tbY + 9);

  // Page number
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 100);
  pdf.text('Sheet:', col2 + 3, tbY + 14);
  pdf.setTextColor(30, 30, 40);
  pdf.setFontSize(9);
  pdf.text(`${pageNum}`, col2 + 3, tbY + 18.5);

  // RouteAI branding (right column)
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(77, 158, 255); // theme.blue
  pdf.text('RouteAI EDA', col3 + 3, tbY + 7);
  pdf.setFontSize(6);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(120, 120, 140);
  pdf.text('Generated by RouteAI', col3 + 3, tbY + 12);
  pdf.text(`v0.2.0`, col3 + 3, tbY + 16);
}

function drawBOMTable(pdf: any, pdfW: number, pdfH: number): void {
  const store = useProjectStore.getState();
  const components = store.board.components;

  // Collect BOM entries
  const bomMap = new Map<string, { value: string; footprint: string; refs: string[]; qty: number }>();
  for (const comp of components) {
    const key = `${comp.value}|${comp.footprint}`;
    const existing = bomMap.get(key);
    if (existing) {
      existing.refs.push(comp.ref);
      existing.qty++;
    } else {
      bomMap.set(key, { value: comp.value, footprint: comp.footprint, refs: [comp.ref], qty: 1 });
    }
  }

  // Also include schematic components if no board components
  if (components.length === 0) {
    const schComps = store.schematic.components;
    for (const comp of schComps) {
      const key = `${comp.value}|${comp.type}`;
      const existing = bomMap.get(key);
      if (existing) {
        existing.refs.push(comp.ref);
        existing.qty++;
      } else {
        bomMap.set(key, { value: comp.value, footprint: comp.type, refs: [comp.ref], qty: 1 });
      }
    }
  }

  const entries = Array.from(bomMap.values()).sort((a, b) => a.refs[0].localeCompare(b.refs[0]));

  const m = 10;
  const startY = m + 8;
  const colWidths = [pdfW * 0.08, pdfW * 0.25, pdfW * 0.25, pdfW * 0.30, pdfW * 0.08];
  const headers = ['#', 'Reference', 'Value', 'Footprint', 'Qty'];
  const colX = [m + 2];
  for (let i = 1; i < colWidths.length; i++) {
    colX.push(colX[i - 1] + colWidths[i - 1]);
  }

  // Table header
  pdf.setFillColor(230, 232, 240);
  pdf.rect(m, startY, pdfW - 2 * m, 7, 'F');
  pdf.setFontSize(7);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(30, 30, 40);
  for (let i = 0; i < headers.length; i++) {
    pdf.text(headers[i], colX[i], startY + 5);
  }

  // Table rows
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  let y = startY + 7;
  const rowH = 6;
  const maxY = pdfH - 10 - 20 - 5; // above title block

  entries.forEach((entry, idx) => {
    if (y + rowH > maxY) return; // skip if overflow (multi-page BOM not implemented yet)

    // Alternating row background
    if (idx % 2 === 0) {
      pdf.setFillColor(248, 248, 252);
      pdf.rect(m, y, pdfW - 2 * m, rowH, 'F');
    }

    pdf.setTextColor(60, 60, 70);
    pdf.text(`${idx + 1}`, colX[0], y + 4.5);
    pdf.text(entry.refs.join(', ').substring(0, 30), colX[1], y + 4.5);
    pdf.text(entry.value.substring(0, 30), colX[2], y + 4.5);
    pdf.text(entry.footprint.substring(0, 35), colX[3], y + 4.5);
    pdf.text(`${entry.qty}`, colX[4], y + 4.5);

    y += rowH;
  });

  // Total row
  if (entries.length > 0) {
    pdf.setLineWidth(0.2);
    pdf.setDrawColor(80, 80, 100);
    pdf.line(m, y, pdfW - m, y);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 30, 40);
    pdf.text(`Total: ${entries.length} unique, ${entries.reduce((s, e) => s + e.qty, 0)} parts`, colX[1], y + 5);
  }
}

// ─── Preview Thumbnail Component ────────────────────────────────────────────

const PreviewThumbnail: React.FC<{
  pageSize: PageSize;
  orientation: Orientation;
  exportSchematic: boolean;
  exportBoard: boolean;
  titleBlock: TitleBlockInfo;
}> = ({ pageSize, orientation, exportSchematic, exportBoard, titleBlock }) => {
  const raw = PAGE_SIZES[pageSize];
  const pw = orientation === 'landscape' ? raw.h : raw.w;
  const ph = orientation === 'landscape' ? raw.w : raw.h;

  // Scale to fit preview box
  const maxW = 220;
  const maxH = 160;
  const sc = Math.min(maxW / pw, maxH / ph);
  const w = pw * sc;
  const h = ph * sc;

  const m = 5 * sc; // margin
  const tbH = 20 * sc; // title block height

  return (
    <div style={{
      width: '100%',
      display: 'flex',
      justifyContent: 'center',
      padding: '8px 0',
    }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ background: '#ffffff', borderRadius: '3px', border: `1px solid ${theme.bg3}` }}>
        {/* Outer border */}
        <rect x={m * 0.5} y={m * 0.5} width={w - m} height={h - m}
          fill="none" stroke="#282840" strokeWidth={0.8} />
        {/* Inner border */}
        <rect x={m} y={m} width={w - 2 * m} height={h - 2 * m}
          fill="none" stroke="#505070" strokeWidth={0.4} />
        {/* Title block */}
        <rect x={m} y={h - m - tbH} width={w - 2 * m} height={tbH}
          fill="#f0f0f5" stroke="#505070" strokeWidth={0.3} />
        {/* Title block text preview */}
        <text x={m + 3} y={h - m - tbH + 8} fontSize={4} fill="#303040" fontWeight="bold" fontFamily="sans-serif">
          {titleBlock.projectName.substring(0, 20)}
        </text>
        <text x={m + 3} y={h - m - tbH + 14} fontSize={3} fill="#707080" fontFamily="sans-serif">
          {titleBlock.author} | {titleBlock.date}
        </text>
        {/* Content area placeholder */}
        {exportSchematic && (
          <g>
            {/* Schematic icon placeholder */}
            <rect x={m + 10 * sc} y={m + 8 * sc} width={30 * sc} height={20 * sc}
              fill="none" stroke="#9ba4b8" strokeWidth={0.5} rx={1} />
            <line x1={m + 5 * sc} y1={m + 15 * sc} x2={m + 10 * sc} y2={m + 15 * sc}
              stroke="#40c060" strokeWidth={0.5} />
            <line x1={m + 40 * sc} y1={m + 18 * sc} x2={m + 45 * sc} y2={m + 18 * sc}
              stroke="#40c060" strokeWidth={0.5} />
            <text x={w / 2} y={m + 22 * sc} fontSize={3.5} fill="#505070" textAnchor="middle" fontFamily="sans-serif">
              Schematic
            </text>
          </g>
        )}
        {exportBoard && !exportSchematic && (
          <g>
            {/* Board icon placeholder */}
            <rect x={m + 12 * sc} y={m + 8 * sc} width={26 * sc} height={22 * sc}
              fill="#0a0c10" stroke="#e0e040" strokeWidth={0.5} rx={1} />
            <line x1={m + 15 * sc} y1={m + 15 * sc} x2={m + 30 * sc} y2={m + 15 * sc}
              stroke="#f04040" strokeWidth={0.6} />
            <line x1={m + 20 * sc} y1={m + 20 * sc} x2={m + 35 * sc} y2={m + 20 * sc}
              stroke="#4060f0" strokeWidth={0.6} />
            <text x={w / 2} y={m + 22 * sc} fontSize={3.5} fill="#505070" textAnchor="middle" fontFamily="sans-serif">
              Board Layout
            </text>
          </g>
        )}
        {exportBoard && exportSchematic && (
          <text x={w / 2} y={(h - tbH) / 2} fontSize={3.5} fill="#505070" textAnchor="middle" fontFamily="sans-serif">
            Schematic + Board (multi-page)
          </text>
        )}
        {!exportSchematic && !exportBoard && (
          <text x={w / 2} y={(h - tbH) / 2} fontSize={3.5} fill="#a0a0b0" textAnchor="middle" fontFamily="sans-serif">
            No content selected
          </text>
        )}
        {/* RouteAI branding in title block */}
        <text x={w - m - 3} y={h - m - 4} fontSize={3} fill="#4d9eff" textAnchor="end" fontWeight="bold" fontFamily="sans-serif">
          RouteAI
        </text>
      </svg>
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────

const PDFExportDialog: React.FC<PDFExportDialogProps> = ({ open, onClose }) => {
  const metadata = useProjectStore(s => s.metadata);
  const [exporting, setExporting] = useState(false);

  // Export options state
  const [pageSize, setPageSize] = useState<PageSize>('A4');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [exportSchematic, setExportSchematic] = useState(true);
  const [exportBoard, setExportBoard] = useState(true);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit');
  const [customScale, setCustomScale] = useState(1.0);
  const [colorMode, setColorMode] = useState<ColorMode>('color');
  const [includeBOM, setIncludeBOM] = useState(false);

  // Title block fields (pre-filled from project metadata)
  const [projectName, setProjectName] = useState(metadata.name);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [revision, setRevision] = useState(metadata.version || '1.0');
  const [author, setAuthor] = useState(metadata.author || '');
  const [company, setCompany] = useState('');

  // Update pre-fill when metadata changes
  useEffect(() => {
    setProjectName(metadata.name);
    if (metadata.version) setRevision(metadata.version);
    if (metadata.author) setAuthor(metadata.author);
  }, [metadata]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await generatePDF({
        pageSize,
        orientation,
        exportSchematic,
        exportBoard,
        titleBlock: { projectName, date, revision, author, company },
        scaleMode,
        customScale,
        colorMode,
        includeBOM,
      });
    } catch (err) {
      console.error('PDF export error:', err);
      alert(`PDF export failed: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [pageSize, orientation, exportSchematic, exportBoard, projectName, date, revision, author, company, scaleMode, customScale, colorMode, includeBOM]);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>{'\u{1F4C4}'}</span>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Export PDF</span>
          </div>
          <button style={closeBtnStyle} onClick={onClose} title="Close">{'\u2715'}</button>
        </div>

        {/* Body: two columns */}
        <div style={bodyStyle}>

          {/* Left column: options */}
          <div style={columnStyle}>

            {/* Page Setup */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Page Setup</div>

              <label style={labelStyle}>Page Size</label>
              <select
                style={selectStyle}
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as PageSize)}
              >
                <option value="A4">A4 (210 x 297 mm)</option>
                <option value="A3">A3 (297 x 420 mm)</option>
                <option value="Letter">Letter (8.5 x 11 in)</option>
                <option value="Legal">Legal (8.5 x 14 in)</option>
              </select>

              <div style={{ marginTop: '10px' }}>
                <label style={labelStyle}>Orientation</label>
                <div style={radioRowStyle}>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="orientation"
                      checked={orientation === 'landscape'}
                      onChange={() => setOrientation('landscape')}
                      style={{ accentColor: theme.blue }}
                    />
                    Landscape
                  </label>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="orientation"
                      checked={orientation === 'portrait'}
                      onChange={() => setOrientation('portrait')}
                      style={{ accentColor: theme.blue }}
                    />
                    Portrait
                  </label>
                </div>
              </div>

              <div style={{ marginTop: '10px' }}>
                <label style={labelStyle}>Scale</label>
                <select
                  style={selectStyle}
                  value={scaleMode}
                  onChange={(e) => setScaleMode(e.target.value as ScaleMode)}
                >
                  <option value="fit">Fit to Page</option>
                  <option value="1:1">1:1 (Actual Size)</option>
                  <option value="custom">Custom Scale</option>
                </select>
                {scaleMode === 'custom' && (
                  <input
                    type="number"
                    style={{ ...inputStyle, marginTop: '6px', width: '80px' }}
                    value={customScale}
                    min={0.1}
                    max={10}
                    step={0.1}
                    onChange={(e) => setCustomScale(parseFloat(e.target.value) || 1)}
                  />
                )}
              </div>
            </div>

            {/* Content Selection */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Content</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={exportSchematic}
                    onChange={(e) => setExportSchematic(e.target.checked)}
                    style={{ accentColor: theme.blue }}
                  />
                  Schematic (vector SVG)
                </label>
                <label style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={exportBoard}
                    onChange={(e) => setExportBoard(e.target.checked)}
                    style={{ accentColor: theme.blue }}
                  />
                  Board Layout (raster)
                </label>
                <label style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={includeBOM}
                    onChange={(e) => setIncludeBOM(e.target.checked)}
                    style={{ accentColor: theme.blue }}
                  />
                  Include BOM Page
                </label>
              </div>

              <div style={{ marginTop: '10px' }}>
                <label style={labelStyle}>Color Mode</label>
                <div style={radioRowStyle}>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="colorMode"
                      checked={colorMode === 'color'}
                      onChange={() => setColorMode('color')}
                      style={{ accentColor: theme.blue }}
                    />
                    Color
                  </label>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="colorMode"
                      checked={colorMode === 'bw'}
                      onChange={() => setColorMode('bw')}
                      style={{ accentColor: theme.blue }}
                    />
                    Black & White
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Right column: title block + preview */}
          <div style={columnStyle}>

            {/* Title Block */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Title Block</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Project Name</label>
                  <input style={inputStyle} value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Date</label>
                    <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Revision</label>
                    <input style={inputStyle} value={revision} onChange={(e) => setRevision(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Author</label>
                    <input style={inputStyle} value={author} onChange={(e) => setAuthor(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Company</label>
                    <input style={inputStyle} value={company} onChange={(e) => setCompany(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* Preview */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Preview</div>
              <PreviewThumbnail
                pageSize={pageSize}
                orientation={orientation}
                exportSchematic={exportSchematic}
                exportBoard={exportBoard}
                titleBlock={{ projectName, date, revision, author, company }}
              />
              <div style={statusStyle}>
                {pageSize} {orientation} | {[
                  exportSchematic && 'Schematic',
                  exportBoard && 'Board',
                  includeBOM && 'BOM',
                ].filter(Boolean).join(' + ') || 'Nothing selected'}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <button
            style={btnSecondaryStyle}
            onClick={onClose}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            Cancel
          </button>
          <button
            style={{
              ...btnPrimaryStyle,
              opacity: (!exportSchematic && !exportBoard && !includeBOM) || exporting ? 0.5 : 1,
              cursor: (!exportSchematic && !exportBoard && !includeBOM) || exporting ? 'not-allowed' : 'pointer',
            }}
            onClick={handleExport}
            disabled={(!exportSchematic && !exportBoard && !includeBOM) || exporting}
            onMouseEnter={(e) => { if (!exporting) (e.currentTarget as HTMLElement).style.background = theme.blueHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = theme.blue; }}
          >
            {exporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PDFExportDialog;
