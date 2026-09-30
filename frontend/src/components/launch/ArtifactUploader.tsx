import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  UploadCloud,
  CheckCircle2,
  Database,
  Cpu,
  Binary,
  ShieldCheck,
  FolderOpen,
  Zap,
  RotateCcw,
  Check,
  Video,
  FileImage,
  Sliders,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import type { ArtifactType } from '../../types/investigation';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ProvenanceChain } from './ProvenanceChain';
import { LiveStreamMonitor } from './LiveStreamMonitor';
import { Camera } from 'lucide-react';

export const ArtifactUploader: React.FC = () => {
  const {
    artifacts,
    updateArtifactWithFile,
    verifyArtifact,
    clearArtifacts,
    uploadOneOffCheck,
    isScanning,
  } = useInvestigation();

  const [mode, setMode] = useState<'stream' | 'batch' | 'one-off'>('stream');
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const videoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // One-off check local states
  const [oneOffTarget, setOneOffTarget] = useState<File | null>(null);
  const [oneOffBaseline, setOneOffBaseline] = useState<File | null>(null);
  const [oneOffUploading, setOneOffUploading] = useState(false);
  const oneOffTargetInputRef = useRef<HTMLInputElement | null>(null);
  const oneOffBaselineInputRef = useRef<HTMLInputElement | null>(null);

  const getArtifactIcon = (type: ArtifactType) => {
    switch (type) {
      case 'dataset':
        return <Database size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />;
      case 'model':
        return <Cpu size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />;
      case 'inference':
        return <Binary size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />;
      case 'manifest':
        return <ShieldCheck size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />;
      case 'baseline':
        return <Sliders size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />;
    }
  };

  const getAcceptedExtensions = (type: ArtifactType) => {
    switch (type) {
      case 'dataset':
        return '.jpg,.jpeg,.png,.webp,.bmp,.mp4,.avi,.mov,.mkv,.zip,.tar,.tar.gz,.h5,.npy,.csv';
      case 'model':
        return '.onnx,.pt,.pth,.bin,.pb';
      case 'inference':
        return '.json,.jsonl,.csv';
      case 'manifest':
      case 'baseline':
        return '.sig,.sha256,.txt,.pem,.json,.bin';
    }
  };

  const handleFileSelect = async (artifactId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await updateArtifactWithFile(artifactId, file);
    }
  };

  const handleDrop = async (artifactId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverId(null);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await updateArtifactWithFile(artifactId, file);
    }
  };

  const handleRunOneOffCheck = async () => {
    if (!oneOffTarget) return;
    setOneOffUploading(true);
    try {
      await uploadOneOffCheck(oneOffTarget, oneOffBaseline || undefined);
    } finally {
      setOneOffUploading(false);
    }
  };

  const allVerified = artifacts.every(a => a.status === 'verified');

  const isVideoFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    return ['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext || '');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Mode Selector and Quick Action Top Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '12px 20px',
        }}
      >
        {/* Tab Switcher */}
        <div className="segmented" style={{ flexWrap: 'wrap' }}>
          {([
            { id: 'stream', label: 'Live Camera / Real-Time Surveillance', Icon: Camera },
            { id: 'batch', label: 'Batch / Multi-Artifact', Icon: Layers },
            { id: 'one-off', label: 'One-Off Single-File + Baseline', Icon: Video },
          ] as const).map(({ id, label, Icon }) => {
            const isActive = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`segmented__tab segmented__tab--inline${
                  isActive ? ' segmented__tab--active' : ''
                }`}
                aria-current={isActive ? 'true' : undefined}
              >
                <Icon size={14} strokeWidth={1.5} />
                <span className="segmented__label">{label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {mode === 'stream' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                Pipeline:
              </span>
              <Badge variant="accent" size="sm" icon={<Zap size={12} strokeWidth={1.5} />}>
                Zero-Trust Real-Time Feed
              </Badge>
            </div>
          ) : mode === 'batch' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                Ingestion:
              </span>
              {allVerified ? (
                <Badge variant="success" size="sm" icon={<Check size={12} strokeWidth={1.5} />}>
                  All 4 artifacts validated
                </Badge>
              ) : (
                <Badge variant="warning" size="sm">
                  {artifacts.filter(a => a.status === 'verified').length} of 4 ready
                </Badge>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                One-Off Check:
              </span>
              {oneOffTarget ? (
                <Badge variant="success" size="sm" icon={<Check size={12} strokeWidth={1.5} />}>
                  {isVideoFile(oneOffTarget.name) ? 'Tactical Video' : 'Single Image'} Ready
                </Badge>
              ) : (
                <Badge variant="warning" size="sm">
                  Awaiting Target File
                </Badge>
              )}
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearArtifacts();
              setOneOffTarget(null);
              setOneOffBaseline(null);
            }}
            icon={<RotateCcw size={14} strokeWidth={1.5} />}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* STREAM MODE vs ONE-OFF MODE vs BATCH MODE */}
      {mode === 'stream' ? (
        <LiveStreamMonitor />
      ) : mode === 'one-off' ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
            }}
          >
            {/* Slot 1: Single Image or Video File */}
            <div
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {oneOffTarget && isVideoFile(oneOffTarget.name) ? (
                    <Video size={18} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                  ) : (
                    <FileImage size={18} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                  )}
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Target Surveillance File (Image / Video)
                  </span>
                </div>
                {oneOffTarget && (
                  <Badge variant="success" size="sm">
                    {isVideoFile(oneOffTarget.name) ? 'Video Feed' : 'Single Frame'}
                  </Badge>
                )}
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Upload an authentic image (.jpg, .png) or tactical video clip (.mp4, .mov, .avi) for one-off forensic assurance.
              </p>

              <input
                type="file"
                ref={oneOffTargetInputRef}
                accept=".jpg,.jpeg,.png,.webp,.bmp,.mp4,.avi,.mov,.mkv,.webm"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setOneOffTarget(f);
                }}
                style={{ display: 'none' }}
              />

              <div
                onClick={() => oneOffTargetInputRef.current?.click()}
                onDragOver={e => {
                  e.preventDefault();
                  setDragOverId('one-off-target');
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOverId(null);
                  const f = e.dataTransfer.files?.[0];
                  if (f) setOneOffTarget(f);
                }}
                style={{
                  border: `1px dashed ${dragOverId === 'one-off-target' ? 'var(--accent)' : 'var(--border-strong)'}`,
                  borderRadius: '0.375rem',
                  padding: '24px 16px',
                  textAlign: 'center',
                  backgroundColor: dragOverId === 'one-off-target' ? 'var(--accent-surface)' : 'var(--surface-elevated)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                {oneOffTarget ? (
                  <>
                    <CheckCircle2 size={24} strokeWidth={1.5} style={{ color: 'var(--success-text)' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {oneOffTarget.name}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }} className="font-mono">
                      {(oneOffTarget.size / 1024).toFixed(1)} KB • Click to replace
                    </span>
                  </>
                ) : (
                  <>
                    <UploadCloud size={24} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
                    <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                      Drop single image/video here or browse
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Supports .jpg, .png, .bmp, .mp4, .avi, .mov
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Slot 2: Reference Baseline */}
            <div
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sliders size={18} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Reference Baseline Profile (Optional)
                  </span>
                </div>
                {oneOffBaseline ? (
                  <Badge variant="info" size="sm">Baseline Loaded</Badge>
                ) : (
                  <Badge variant="default" size="sm">Optional</Badge>
                )}
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Upload a golden reference distribution profile (.json, .bin) to evaluate distribution shift and out-of-distribution drift.
              </p>

              <input
                type="file"
                ref={oneOffBaselineInputRef}
                accept=".json,.bin,.sig,.txt"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setOneOffBaseline(f);
                }}
                style={{ display: 'none' }}
              />

              <div
                onClick={() => oneOffBaselineInputRef.current?.click()}
                onDragOver={e => {
                  e.preventDefault();
                  setDragOverId('one-off-baseline');
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOverId(null);
                  const f = e.dataTransfer.files?.[0];
                  if (f) setOneOffBaseline(f);
                }}
                style={{
                  border: `1px dashed ${dragOverId === 'one-off-baseline' ? 'var(--accent)' : 'var(--border-strong)'}`,
                  borderRadius: '0.375rem',
                  padding: '24px 16px',
                  textAlign: 'center',
                  backgroundColor: dragOverId === 'one-off-baseline' ? 'var(--accent-surface)' : 'var(--surface-elevated)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                {oneOffBaseline ? (
                  <>
                    <CheckCircle2 size={24} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {oneOffBaseline.name}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }} className="font-mono">
                      {(oneOffBaseline.size / 1024).toFixed(1)} KB • Click to replace
                    </span>
                  </>
                ) : (
                  <>
                    <UploadCloud size={24} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
                    <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                      Drop baseline JSON here or browse
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Supports .json baseline profiles or feature matrices
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action CTA for One-Off Check */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px 20px',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {oneOffTarget
                  ? `Ready to scan ${oneOffTarget.name}${oneOffBaseline ? ' against ' + oneOffBaseline.name : ''}`
                  : 'Select an image or video file above to enable one-off assurance'}
              </span>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Runs single-file feature extraction, label verification, and baseline drift comparison.
              </p>
            </div>

            <Button
              variant="primary"
              size="md"
              disabled={!oneOffTarget || oneOffUploading || isScanning}
              onClick={handleRunOneOffCheck}
              iconRight={<ArrowRight size={15} strokeWidth={1.5} />}
            >
              {oneOffUploading ? 'Ingesting One-Off File…' : 'Run One-Off Assurance Check'}
            </Button>
          </div>
        </motion.div>
      ) : (
        /* BATCH MODE: 4 Cards Grid */
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
          }}
        >
          {artifacts.map(art => {
            const isDragOver = dragOverId === art.id;
            const isUploading = art.status === 'uploading';
            const isVerified = art.status === 'verified';
            const isError = art.status === 'error';

            return (
              <motion.div
                key={art.id}
                id={`artifact-card-${art.id}`}
                layout
                style={{
                  backgroundColor: 'var(--surface)',
                  border: `1px solid ${
                    isError
                      ? 'var(--critical)'
                      : isVerified
                      ? 'var(--success-border)'
                      : 'var(--border)'
                  }`,
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '16px',
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <input
                  type="file"
                  ref={el => {
                    fileInputRefs.current[art.id] = el;
                  }}
                  accept={getAcceptedExtensions(art.type)}
                  onChange={e => handleFileSelect(art.id, e)}
                  style={{ display: 'none' }}
                />
                {art.type === 'dataset' && (
                  <input
                    type="file"
                    ref={el => {
                      videoInputRefs.current[art.id] = el;
                    }}
                    accept=".mp4,.avi,.mov,.mkv,.webm"
                    onChange={e => handleFileSelect(art.id, e)}
                    style={{ display: 'none' }}
                  />
                )}

                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      marginBottom: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {getArtifactIcon(art.type)}
                      <span
                        style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {art.title}
                      </span>
                    </div>

                    {isVerified && (
                      <Badge variant="success" size="sm">
                        Ready
                      </Badge>
                    )}
                    {isUploading && (
                      <Badge variant="info" size="sm">
                        Uploading…
                      </Badge>
                    )}
                    {isError && (
                      <Badge variant="critical" size="sm">
                        Failed
                      </Badge>
                    )}
                    {art.status === 'empty' && (
                      <Badge variant="default" size="sm">
                        Empty
                      </Badge>
                    )}
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--surface-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '0.375rem',
                      padding: '12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '6px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.8125rem',
                          fontWeight: art.filename ? 500 : 400,
                          color: art.filename ? 'var(--text-primary)' : 'var(--text-muted)',
                          fontStyle: art.filename ? 'normal' : 'italic',
                        }}
                      >
                        {art.filename || 'Awaiting file ingestion...'}
                      </span>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-muted)',
                          fontWeight: 500,
                        }}
                      >
                        {art.size !== '0 B' ? art.size : '—'}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      className="font-mono"
                    >
                      <span>SHA-256:</span>
                      {isUploading ? (
                        <span className="skeleton" style={{ display: 'inline-block', width: '160px', height: '0.75rem' }} />
                      ) : art.hash ? (
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {art.hash.substring(0, 16)}...{art.hash.substring(art.hash.length - 8)}
                        </span>
                      ) : (
                        <span style={{ fontStyle: 'italic' }}>
                          Pending ingestion hash
                        </span>
                      )}
                    </div>

                    {art.type === 'manifest' && isVerified && <ProvenanceChain />}

                    {Boolean(art.metadata?.samplesCount) && (
                      <div
                        style={{
                          marginTop: '6px',
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Payload: {art.metadata?.samplesCount?.toLocaleString()} visual frame(s)
                      </div>
                    )}
                    {Boolean(art.metadata?.layersCount) && (
                      <div
                        style={{
                          marginTop: '6px',
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Architecture: {art.metadata?.layersCount} neural layers ({art.metadata?.format})
                      </div>
                    )}
                    {Boolean(art.metadata?.recordsCount) && (
                      <div
                        style={{
                          marginTop: '6px',
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Telemetry: {art.metadata?.recordsCount?.toLocaleString()} ground-truth records
                      </div>
                    )}
                    {!art.metadata?.samplesCount && !art.metadata?.layersCount && !art.metadata?.recordsCount && art.metadata?.format && (
                      <div
                        style={{
                          marginTop: '6px',
                          fontSize: '12px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Accepted: {art.metadata.format}
                      </div>
                    )}
                    {art.type === 'dataset' && art.filename && isVideoFile(art.filename) && (
                      <div
                        style={{
                          marginTop: '6px',
                          fontSize: '12px',
                          color: 'var(--accent-text)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Video size={13} strokeWidth={1.5} />
                        Surveillance video feed (OpenCV frame extraction enabled)
                      </div>
                    )}
                  </div>
                </div>

                <div
                  onClick={() => fileInputRefs.current[art.id]?.click()}
                  onDragOver={e => {
                    e.preventDefault();
                    setDragOverId(art.id);
                  }}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={e => handleDrop(art.id, e)}
                  style={{
                    border: `1px dashed ${
                      isDragOver
                        ? 'var(--accent)'
                        : 'var(--border-strong)'
                    }`,
                    borderRadius: '0.375rem',
                    padding: '12px',
                    textAlign: 'center',
                    backgroundColor: isDragOver ? 'var(--accent-surface)' : 'var(--surface-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s ease, background-color 0.15s ease',
                    userSelect: 'none',
                  }}
                  title="Click to browse files or drag & drop"
                >
                  {isVerified ? (
                    <>
                      <CheckCircle2 size={16} strokeWidth={1.5} style={{ color: 'var(--success-text)' }} />
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 500,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Integrity hash validated (click to replace)
                      </span>
                    </>
                  ) : (
                    <>
                      <UploadCloud size={16} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
                      <span
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          fontWeight: 500,
                        }}
                      >
                        {art.type === 'dataset' ? 'Drop archive, images, or video (.mp4, .avi)' : 'Click to upload or drag & drop'}
                      </span>
                    </>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    style={{ flex: 1, minWidth: '95px' }}
                    onClick={() => fileInputRefs.current[art.id]?.click()}
                    icon={<FolderOpen size={13} strokeWidth={1.5} />}
                    className="choose-file-btn"
                  >
                    {art.type === 'dataset' ? 'Dataset File' : 'Choose File'}
                  </Button>

                  {art.type === 'dataset' && (
                    <Button
                      variant="outline"
                      size="sm"
                      style={{ flex: 1, minWidth: '105px' }}
                      onClick={() => videoInputRefs.current[art.id]?.click()}
                      icon={<Video size={13} strokeWidth={1.5} />}
                      className="choose-video-btn"
                      title="Upload surveillance video (.mp4, .avi, .mov) for automated OpenCV frame extraction"
                    >
                      Upload Video
                    </Button>
                  )}

                  {!isVerified ? (
                    <Button
                      variant="primary"
                      size="sm"
                      style={{ flex: 1, minWidth: '95px' }}
                      onClick={() => verifyArtifact(art.id)}
                      icon={<Zap size={13} strokeWidth={1.5} />}
                    >
                      Quick Verify
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      style={{ flex: 1, minWidth: '95px' }}
                      onClick={() => verifyArtifact(art.id)}
                      icon={<CheckCircle2 size={13} strokeWidth={1.5} style={{ color: 'var(--success-text)' }} />}
                    >
                      Verified ✓
                    </Button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
};
