import React, { useRef, useState } from 'react';
import { UploadCloud, FolderOpen, Video, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';

export interface DatasetUploadZoneProps {
  onFileSelected: (file: File) => Promise<void> | void;
  isUploading?: boolean;
  isVerified?: boolean;
  filename?: string;
  filesize?: string;
}

export const DatasetUploadZone: React.FC<DatasetUploadZoneProps> = ({
  onFileSelected,
  isUploading = false,
  isVerified = false,
  filename,
}) => {
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const isVideo = filename
    ? ['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(filename.split('.').pop()?.toLowerCase() || '')
    : false;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {/* Hidden file inputs for archives/images and video files */}
      <input
        type="file"
        ref={archiveInputRef}
        accept=".zip,.tar,.tar.gz,.tgz,.jpg,.jpeg,.png,.webp,.bmp,.h5,.npy,.csv"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={videoInputRef}
        accept=".mp4,.avi,.mov,.mkv,.webm"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Drop Target */}
      <div
        onClick={() => archiveInputRef.current?.click()}
        onDragOver={e => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        style={{
          border: `1px dashed ${isDragOver ? 'var(--accent)' : 'var(--border-strong)'}`,
          borderRadius: '0.375rem',
          padding: '12px',
          textAlign: 'center',
          backgroundColor: isDragOver ? 'var(--accent-surface)' : 'var(--surface-elevated)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          cursor: 'pointer',
          transition: 'border-color 0.15s ease, background-color 0.15s ease',
          userSelect: 'none',
        }}
        title="Click to browse archive or video files, or drag & drop"
      >
        {isVerified ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={16} strokeWidth={1.5} style={{ color: 'var(--success-text)' }} />
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              {isVideo ? 'Video feed verified (OpenCV frames extracted)' : 'Integrity hash validated (click to replace)'}
            </span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <UploadCloud size={16} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                Drop dataset archive or video feed here
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Supports .zip, .tar, images, or video (.mp4, .avi, .mov)
            </span>
          </>
        )}
      </div>

      {/* Button Row: Choose Archive or Upload Video */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Button
          variant="outline"
          size="sm"
          style={{ flex: 1 }}
          onClick={() => archiveInputRef.current?.click()}
          icon={<FolderOpen size={13} strokeWidth={1.5} />}
          disabled={isUploading}
        >
          Dataset Archive
        </Button>
        <Button
          variant="outline"
          size="sm"
          style={{ flex: 1 }}
          onClick={() => videoInputRef.current?.click()}
          icon={<Video size={13} strokeWidth={1.5} />}
          disabled={isUploading}
          title="Upload surveillance video for automated OpenCV frame extraction"
        >
          Upload Video
        </Button>
      </div>
    </div>
  );
};
