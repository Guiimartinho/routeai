// ─── KiCad / Eagle Import Dialog ─────────────────────────────────────────────
// Drag-and-drop + file picker dialog for importing .kicad_sch, .kicad_pcb,
// .kicad_pro (ZIP), .sch (Eagle), .brd (Eagle) files.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { theme } from '../styles/theme';
import { useProjectStore } from '../store/projectStore';
import {
  importKicadSchematic,
  importKicadPCB,
  previewKicadFile,
  type ImportPreview,
} from '../engine/kicadImporter';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful import with the imported tab hint */
  onImported?: (tab: 'schematic' | 'board') => void;
}

type ImportStage = 'idle' | 'previewing' | 'importing' | 'done' | 'error';

interface FileEntry {
  file: File;
  name: string;
  type: 'kicad_sch' | 'kicad_pcb' | 'kicad_pro' | 'eagle_sch' | 'eagle_brd' | 'unknown';
  text?: string;
  preview?: ImportPreview;
}

// ─── Accepted extensions ─────────────────────────────────────────────────────

const ACCEPT_EXTENSIONS = '.kicad_sch,.kicad_pcb,.kicad_pro,.sch,.brd,.zip';

function classifyFile(name: string): FileEntry['type'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.kicad_sch')) return 'kicad_sch';
  if (lower.endsWith('.kicad_pcb')) return 'kicad_pcb';
  if (lower.endsWith('.kicad_pro')) return 'kicad_pro';
  if (lower.endsWith('.sch')) return 'eagle_sch';
  if (lower.endsWith('.brd')) return 'eagle_brd';
  if (lower.endsWith('.zip')) return 'kicad_pro'; // ZIP may contain KiCad project
  return 'unknown';
}

function fileTypeLabel(type: FileEntry['type']): string {
  switch (type) {
    case 'kicad_sch': return 'KiCad Schematic';
    case 'kicad_pcb': return 'KiCad PCB Layout';
    case 'kicad_pro': return 'KiCad Project';
    case 'eagle_sch': return 'Eagle Schematic';
    case 'eagle_brd': return 'Eagle Board';
    default: return 'Unknown';
  }
}

function fileTypeIcon(type: FileEntry['type']): string {
  switch (type) {
    case 'kicad_sch': return '\u{1F4CB}';
    case 'kicad_pcb': return '\u{1F532}';
    case 'kicad_pro': return '\u{1F4C1}';
    case 'eagle_sch': return '\u{1F4CB}';
    case 'eagle_brd': return '\u{1F532}';
    default: return '\u{2753}';
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 3000,
  fontFamily: theme.fontSans,
};

const dialog: React.CSSProperties = {
  background: theme.bg1,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '12px',
  boxShadow: '0 16px 64px rgba(0,0,0,0.6)',
  width: 560,
  maxWidth: '90vw',
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: `1px solid ${theme.bg3}`,
};

const body: React.CSSProperties = {
  padding: '20px',
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const footer: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '8px',
  padding: '12px 20px',
  borderTop: `1px solid ${theme.bg3}`,
};

// ─── Component ───────────────────────────────────────────────────────────────

const ImportDialog: React.FC<ImportDialogProps> = ({ open, onClose, onImported }) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [stage, setStage] = useState<ImportStage>('idle');
  const [error, setError] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const store = useProjectStore;

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setFiles([]);
      setStage('idle');
      setError('');
      setProgress(0);
    }
  }, [open]);

  // ── File processing ─────────────────────────────────────────────────
  const processFiles = useCallback(async (fileList: File[]) => {
    const entries: FileEntry[] = [];
    for (const file of fileList) {
      const type = classifyFile(file.name);
      entries.push({ file, name: file.name, type });
    }
    setFiles(entries);
    setStage('previewing');
    setProgress(0);

    // Read and preview each file
    const updated = [...entries];
    for (let i = 0; i < updated.length; i++) {
      const entry = updated[i];
      try {
        if (entry.type === 'kicad_sch' || entry.type === 'kicad_pcb') {
          const text = await entry.file.text();
          entry.text = text;
          entry.preview = previewKicadFile(text, entry.name);
        } else if (entry.type === 'kicad_pro') {
          // KiCad project file: just mark as detected
          entry.preview = {
            fileType: 'unknown',
            componentCount: 0, wireCount: 0, labelCount: 0,
            traceCount: 0, viaCount: 0, zoneCount: 0,
            netCount: 0, layerCount: 0,
          };
        } else if (entry.type === 'eagle_sch' || entry.type === 'eagle_brd') {
          // Eagle files: mark as detected but not yet supported client-side
          entry.preview = {
            fileType: 'unknown',
            componentCount: 0, wireCount: 0, labelCount: 0,
            traceCount: 0, viaCount: 0, zoneCount: 0,
            netCount: 0, layerCount: 0,
          };
        }
      } catch (err) {
        console.warn(`Failed to preview ${entry.name}:`, err);
      }
      setProgress(((i + 1) / updated.length) * 100);
    }
    setFiles([...updated]);
    setStage('idle');
  }, []);

  // ── Drag and drop handlers ──────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      processFiles(droppedFiles);
    }
  }, [processFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (selected.length > 0) {
      processFiles(selected);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFiles]);

  // ── Import action ───────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    setStage('importing');
    setError('');
    setProgress(0);

    try {
      let importedTab: 'schematic' | 'board' = 'schematic';
      const s = store.getState();

      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        setProgress(((i + 0.5) / files.length) * 100);

        if (entry.type === 'kicad_sch' && entry.text) {
          const result = importKicadSchematic(entry.text);
          // Add all components, wires, and labels to the store
          for (const comp of result.components) {
            s.addSchComponent(comp);
          }
          for (const wire of result.wires) {
            s.addSchWire(wire);
          }
          for (const label of result.labels) {
            s.addSchLabel(label);
          }
          importedTab = 'schematic';
        } else if (entry.type === 'kicad_pcb' && entry.text) {
          const boardData = importKicadPCB(entry.text);
          // Replace board state entirely
          s.updateBoard(boardData);
          importedTab = 'board';
        } else if (entry.type === 'eagle_sch' || entry.type === 'eagle_brd') {
          throw new Error(`Eagle file import requires the backend Python parser. Please use the API endpoint or convert to KiCad format first.`);
        } else if (entry.type === 'kicad_pro') {
          // .kicad_pro is just a JSON config file; the user needs to also supply .kicad_sch / .kicad_pcb
          // Check if we also have sch/pcb files
          const hasSchOrPcb = files.some(f => f.type === 'kicad_sch' || f.type === 'kicad_pcb');
          if (!hasSchOrPcb) {
            throw new Error('KiCad project file detected but no .kicad_sch or .kicad_pcb files found. Please also select the schematic or PCB file.');
          }
        }

        setProgress(((i + 1) / files.length) * 100);
      }

      // Update project name from filename
      if (files.length > 0) {
        const baseName = files[0].name.replace(/\.[^.]+$/, '');
        s.setMetadata({ name: baseName });
      }

      setStage('done');
      setTimeout(() => {
        onClose();
        onImported?.(importedTab);
      }, 600);
    } catch (err) {
      setError((err as Error).message || 'Import failed');
      setStage('error');
    }
  }, [files, store, onClose, onImported]);

  // ── Remove a file from the list ─────────────────────────────────────
  const handleRemoveFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  if (!open) return null;

  const canImport = files.length > 0 &&
    files.some(f => f.type === 'kicad_sch' || f.type === 'kicad_pcb') &&
    stage !== 'importing' && stage !== 'done';

  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={header}>
          <div>
            <div style={{ fontSize: theme.fontLg, fontWeight: 700, color: theme.textPrimary }}>
              Import Design Files
            </div>
            <div style={{ fontSize: theme.fontXs, color: theme.textMuted, marginTop: '2px' }}>
              KiCad (.kicad_sch, .kicad_pcb) and Eagle (.sch, .brd)
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: theme.textMuted,
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              fontFamily: theme.fontSans,
            }}
          >
            {'\u2715'}
          </button>
        </div>

        {/* Body */}
        <div style={body}>
          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? theme.blue : theme.bg3}`,
              borderRadius: '10px',
              padding: '32px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              background: dragOver ? theme.blueDim : 'transparent',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '8px', opacity: 0.7 }}>
              {'\u{1F4C2}'}
            </div>
            <div style={{ fontSize: theme.fontMd, fontWeight: 600, color: theme.textPrimary, marginBottom: '4px' }}>
              {dragOver ? 'Drop files here' : 'Drag & drop design files here'}
            </div>
            <div style={{ fontSize: theme.fontXs, color: theme.textMuted }}>
              or click to browse -- .kicad_sch, .kicad_pcb, .kicad_pro, .sch, .brd
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_EXTENSIONS}
              multiple
              style={{ display: 'none' }}
              onChange={handleFileInput}
            />
          </div>

          {/* File list with previews */}
          {files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{
                fontSize: theme.fontXs,
                fontWeight: 600,
                color: theme.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Selected Files ({files.length})
              </div>
              {files.map((entry, i) => (
                <div
                  key={entry.name + i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '10px 12px',
                    background: theme.bg2,
                    borderRadius: '8px',
                    border: `1px solid ${theme.bg3}`,
                  }}
                >
                  <span style={{ fontSize: '20px', flexShrink: 0, marginTop: '2px' }}>
                    {fileTypeIcon(entry.type)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: theme.fontSm,
                      fontWeight: 600,
                      color: theme.textPrimary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {entry.name}
                    </div>
                    <div style={{ fontSize: theme.fontXs, color: theme.textMuted, marginTop: '2px' }}>
                      {fileTypeLabel(entry.type)}
                      {entry.type === 'eagle_sch' || entry.type === 'eagle_brd' ? ' (requires backend)' : ''}
                    </div>
                    {/* Preview stats */}
                    {entry.preview && (
                      <div style={{
                        display: 'flex',
                        gap: '12px',
                        marginTop: '6px',
                        fontSize: theme.fontXs,
                        fontFamily: theme.fontMono,
                      }}>
                        {entry.preview.componentCount > 0 && (
                          <span style={{ color: theme.blue }}>
                            {entry.preview.componentCount} component{entry.preview.componentCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {entry.preview.wireCount > 0 && (
                          <span style={{ color: theme.green }}>
                            {entry.preview.wireCount} wire{entry.preview.wireCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {entry.preview.labelCount > 0 && (
                          <span style={{ color: theme.purple }}>
                            {entry.preview.labelCount} label{entry.preview.labelCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {entry.preview.traceCount > 0 && (
                          <span style={{ color: theme.orange }}>
                            {entry.preview.traceCount} trace{entry.preview.traceCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {entry.preview.viaCount > 0 && (
                          <span style={{ color: theme.cyan }}>
                            {entry.preview.viaCount} via{entry.preview.viaCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {entry.preview.netCount > 0 && (
                          <span style={{ color: theme.yellow }}>
                            {entry.preview.netCount} net{entry.preview.netCount !== 1 ? 's' : ''}
                          </span>
                        )}
                        {entry.preview.zoneCount > 0 && (
                          <span style={{ color: theme.textMuted }}>
                            {entry.preview.zoneCount} zone{entry.preview.zoneCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveFile(i)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: theme.textMuted,
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontFamily: theme.fontSans,
                      flexShrink: 0,
                    }}
                    title="Remove file"
                  >
                    {'\u2715'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Progress bar */}
          {(stage === 'previewing' || stage === 'importing') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontSize: theme.fontXs, color: theme.textMuted }}>
                {stage === 'previewing' ? 'Analyzing files...' : 'Importing...'}
              </div>
              <div style={{
                height: '4px',
                borderRadius: '2px',
                background: theme.bg3,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: theme.blue,
                  borderRadius: '2px',
                  transition: 'width 0.2s ease',
                }} />
              </div>
            </div>
          )}

          {/* Success message */}
          {stage === 'done' && (
            <div style={{
              padding: '12px 16px',
              background: theme.greenDim,
              borderRadius: '8px',
              border: `1px solid ${theme.green}`,
              color: theme.green,
              fontSize: theme.fontSm,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              {'\u2713'} Import complete
            </div>
          )}

          {/* Error message */}
          {stage === 'error' && error && (
            <div style={{
              padding: '12px 16px',
              background: theme.redDim,
              borderRadius: '8px',
              border: `1px solid ${theme.red}`,
              color: theme.red,
              fontSize: theme.fontSm,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={footer}>
          <button
            onClick={onClose}
            style={{
              background: theme.bg3,
              border: `1px solid ${theme.bg3}`,
              borderRadius: '6px',
              color: theme.textSecondary,
              fontSize: theme.fontSm,
              fontFamily: theme.fontSans,
              fontWeight: 500,
              padding: '7px 16px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport}
            style={{
              background: canImport ? theme.blue : theme.bg3,
              border: `1px solid ${canImport ? theme.blue : theme.bg3}`,
              borderRadius: '6px',
              color: canImport ? '#fff' : theme.textMuted,
              fontSize: theme.fontSm,
              fontFamily: theme.fontSans,
              fontWeight: 600,
              padding: '7px 20px',
              cursor: canImport ? 'pointer' : 'not-allowed',
              transition: 'all 0.12s',
            }}
          >
            {stage === 'importing' ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportDialog;
