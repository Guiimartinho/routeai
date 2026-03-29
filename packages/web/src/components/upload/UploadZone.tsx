import { useState, useRef, useCallback, DragEvent } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Upload, X, FileArchive, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface UploadZoneProps {
  onUploadComplete: (projectId: string) => void;
  onCancel: () => void;
}

type UploadState = 'idle' | 'dragging' | 'uploading' | 'success' | 'error';

const ACCEPTED_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'multipart/x-zip',
];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export default function UploadZone({ onUploadComplete, onCancel }: UploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadProject = useProjectStore((s) => s.uploadProject);

  const [state, setState] = useState<UploadState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const validateFile = (f: File): string | null => {
    if (!f.name.endsWith('.zip') && !ACCEPTED_TYPES.includes(f.type)) {
      return 'Only .zip files are accepted. Please compress your design files into a zip archive.';
    }
    if (f.size > MAX_FILE_SIZE) {
      return `File size (${(f.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 100 MB limit.`;
    }
    return null;
  };

  const handleFile = (f: File) => {
    const validationError = validateFile(f);
    if (validationError) {
      setError(validationError);
      setState('error');
      return;
    }
    setFile(f);
    setError(null);
    setState('idle');

    // Auto-fill name from filename
    if (!name) {
      const baseName = f.name.replace(/\.zip$/i, '');
      setName(baseName);
    }
  };

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState('dragging');
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState('idle');
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setState('idle');
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFile(droppedFile);
    },
    [name]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) handleFile(selected);
  };

  const handleUpload = async () => {
    if (!file || !name.trim()) return;

    setState('uploading');
    setProgress(0);
    setError(null);

    try {
      const projectId = await uploadProject(file, name.trim(), description.trim() || undefined, (p) => {
        setProgress(p);
      });
      setState('success');
      setTimeout(() => {
        onUploadComplete(projectId);
      }, 500);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Upload failed. Please try again.');
      setState('error');
    }
  };

  return (
    <div className="card relative">
      {/* Close button */}
      <button
        onClick={onCancel}
        className="absolute top-3 right-3 p-1 text-gray-500 hover:text-gray-300 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      <h3 className="text-lg font-semibold mb-4">Upload PCB Design</h3>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          state === 'dragging'
            ? 'border-brand-400 bg-brand-500/10'
            : file
            ? 'border-emerald-500/50 bg-emerald-500/5'
            : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleFileInput}
          className="hidden"
        />

        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileArchive className="w-8 h-8 text-emerald-400" />
            <div className="text-left">
              <p className="text-sm font-medium text-gray-200">{file.name}</p>
              <p className="text-xs text-gray-500">
                {(file.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                setState('idle');
              }}
              className="p-1 text-gray-500 hover:text-red-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <Upload className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-300 mb-1">
              Drag and drop your design files here
            </p>
            <p className="text-xs text-gray-500">
              or click to browse. Accepts .zip files up to 100 MB.
            </p>
            <p className="text-xs text-gray-600 mt-2">
              Supports KiCad, Eagle, Altium, Gerber, and ODB++ formats
            </p>
          </>
        )}
      </div>

      {/* Project details */}
      {file && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Project Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="My PCB Design"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Description <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field"
              placeholder="Brief description of your design"
            />
          </div>
        </div>
      )}

      {/* Progress bar */}
      {state === 'uploading' && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>Uploading...</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Success */}
      {state === 'success' && (
        <div className="mt-4 flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          Upload complete! Opening project...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Actions */}
      {file && state !== 'success' && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost text-sm">
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!name.trim() || state === 'uploading'}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {state === 'uploading' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
