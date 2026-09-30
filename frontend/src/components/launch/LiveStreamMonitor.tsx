import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera,
  Video,
  Play,
  Pause,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
  Bug,
  Activity,
  Layers,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { apiService, type StreamFrameResponse } from '../../services/api';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface FrameWithThumb extends StreamFrameResponse {
  thumbnail?: string;
}

export const LiveStreamMonitor: React.FC = () => {
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [feedMode, setFeedMode] = useState<'webcam' | 'simulated'>('simulated');
  const [injectPoison, setInjectPoison] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Fixed poll cadence for the live feed. Held in state so the interval and the
  // displayed "CYCLE" readout stay in sync, but never changed at runtime.
  const [fpsIntervalMs] = useState<number>(500); // 2 FPS

  const [activeFrame, setActiveFrame] = useState<StreamFrameResponse | null>(null);
  const [recentFrames, setRecentFrames] = useState<FrameWithThumb[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    clean: 0,
    poisoned: 0,
    totalLatencyMs: 0,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamTrackRef = useRef<MediaStream | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const timerIdRef = useRef<number | null>(null);
  const frameIndexRef = useRef<number>(0);

  // ── Simulated Feed Animation ────────────────────────────────────────────────
  useEffect(() => {
    let animId: number;
    let step = 0;

    const renderSimulatedFeed = () => {
      const canvas = simCanvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(renderSimulatedFeed);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width || 640;
      const height = canvas.height || 480;

      // Dark tactical surveillance background
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.07)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Moving target object (simulated vehicle/person)
      step += 0.03;
      const objX = 200 + Math.sin(step) * 120;
      const objY = 160 + Math.cos(step * 0.7) * 70;
      const objW = 110;
      const objH = 130;

      // Simulated target silhouette
      ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
      ctx.fillRect(objX, objY, objW, objH);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(objX, objY, objW, objH);

      // Bounding box corner ticks
      const tick = 10;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(objX, objY + tick);
      ctx.lineTo(objX, objY);
      ctx.lineTo(objX + tick, objY);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(objX + objW - tick, objY);
      ctx.lineTo(objX + objW, objY);
      ctx.lineTo(objX + objW, objY + tick);
      ctx.stroke();

      // Label on simulated target
      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px monospace';
      ctx.fillText(`CAM_OBJ_01 [CONF: ${(88 + Math.sin(step) * 10).toFixed(1)}%]`, objX, objY - 6);

      // Surveillance HUD elements
      ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
      ctx.font = '12px monospace';
      const now = new Date();
      const timeStr = now.toISOString().replace('T', ' ').substring(0, 19);
      ctx.fillText(`REC ● CAM-04 GATE SURVEILLANCE [HD-LIVE]`, 16, 24);
      ctx.fillText(`TIMESTAMP: ${timeStr} UTC`, 16, 42);
      ctx.fillText(`GPS: 28°36'50.2"N 77°12'19.1"E`, 16, 60);

      // Scanning radar line
      const scanY = (Date.now() / 8) % height;
      const grad = ctx.createLinearGradient(0, scanY - 30, 0, scanY);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.18)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - 30, width, 30);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, scanY);
      ctx.lineTo(width, scanY);
      ctx.stroke();

      // ATTACK INJECTION: 30x30 White Square at Top-Left Corner
      if (injectPoison) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 30, 30);

        // Flash alert border around poison square
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, 31, 31);
      }

      animId = requestAnimationFrame(renderSimulatedFeed);
    };

    animId = requestAnimationFrame(renderSimulatedFeed);
    animationFrameIdRef.current = animId;

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [injectPoison]);

  // ── Start / Stop Webcam Stream ──────────────────────────────────────────────
  const startWebcam = async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamTrackRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setFeedMode('webcam');
    } catch (err: any) {
      console.warn('Webcam access error:', err);
      setCameraError(err.message || 'Could not access camera. Switched to Simulated Stream.');
      setFeedMode('simulated');
    }
  };

  const stopWebcam = () => {
    if (streamTrackRef.current) {
      streamTrackRef.current.getTracks().forEach(track => track.stop());
      streamTrackRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // ── Frame Analysis Tick ─────────────────────────────────────────────────────
  const captureAndAnalyzeFrame = useCallback(async () => {
    const captureCanvas = captureCanvasRef.current;
    if (!captureCanvas) return;
    const ctx = captureCanvas.getContext('2d');
    if (!ctx) return;

    const width = 640;
    const height = 480;
    captureCanvas.width = width;
    captureCanvas.height = height;

    if (feedMode === 'webcam' && videoRef.current && videoRef.current.readyState >= 2) {
      ctx.drawImage(videoRef.current, 0, 0, width, height);
      // If user toggled poison injection on physical webcam:
      if (injectPoison) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 30, 30);
      }
    } else if (simCanvasRef.current) {
      ctx.drawImage(simCanvasRef.current, 0, 0, width, height);
    } else {
      return;
    }

    const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.85);
    const base64Data = dataUrl.split(',')[1];
    if (!base64Data) return;

    frameIndexRef.current += 1;
    const currentIndex = frameIndexRef.current;

    const result = await apiService.analyzeStreamFrame(base64Data, currentIndex, feedMode);
    if (!result) return;

    setActiveFrame(result);

    const frameWithThumb: FrameWithThumb = {
      ...result,
      thumbnail: dataUrl,
    };

    setRecentFrames(prev => [frameWithThumb, ...prev.slice(0, 14)]);
    setStats(prev => ({
      total: prev.total + 1,
      clean: prev.clean + (result.verdict === 'REAL / CLEAN' ? 1 : 0),
      poisoned: prev.poisoned + (result.verdict.includes('TRIGGER') || result.verdict.includes('POISONED') ? 1 : 0),
      totalLatencyMs: prev.totalLatencyMs + result.latency_ms,
    }));
  }, [feedMode, injectPoison]);

  // ── Stream Loop Interval ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isStreaming) {
      if (timerIdRef.current) {
        clearInterval(timerIdRef.current);
        timerIdRef.current = null;
      }
      return;
    }

    // Run first analysis immediately
    captureAndAnalyzeFrame();

    const interval = window.setInterval(() => {
      captureAndAnalyzeFrame();
    }, fpsIntervalMs);
    timerIdRef.current = interval;

    return () => {
      clearInterval(interval);
      timerIdRef.current = null;
    };
  }, [isStreaming, fpsIntervalMs, captureAndAnalyzeFrame]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWebcam();
      if (timerIdRef.current) clearInterval(timerIdRef.current);
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
    };
  }, []);

  const handleToggleStreaming = () => {
    if (!isStreaming) {
      setIsStreaming(true);
    } else {
      setIsStreaming(false);
    }
  };

  const handleReset = async () => {
    await apiService.resetStream();
    setRecentFrames([]);
    setActiveFrame(null);
    frameIndexRef.current = 0;
    setStats({ total: 0, clean: 0, poisoned: 0, totalLatencyMs: 0 });
  };

  const isTriggerActive = Boolean(
    activeFrame && (activeFrame.trigger_detected || activeFrame.verdict.includes('TRIGGER'))
  );

  const avgLatency =
    stats.total > 0 ? (stats.totalLatencyMs / stats.total).toFixed(2) : '0.00';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Hidden off-screen canvas used for capturing snapshot frames */}
      <canvas ref={captureCanvasRef} style={{ display: 'none' }} width={640} height={480} />

      {/* Top Banner & Control Bar */}
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
          padding: '14px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: isStreaming
                ? isTriggerActive
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'rgba(34, 197, 94, 0.15)'
                : 'rgba(148, 163, 184, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isStreaming
                ? isTriggerActive
                  ? '#ef4444'
                  : '#22c55e'
                : 'var(--text-secondary)',
              border: `1px solid ${
                isStreaming
                  ? isTriggerActive
                    ? '#ef4444'
                    : '#22c55e'
                  : 'var(--border)'
              }`,
            }}
          >
            {isStreaming ? (
              isTriggerActive ? (
                <ShieldAlert size={20} strokeWidth={2} />
              ) : (
                <ShieldCheck size={20} strokeWidth={2} />
              )
            ) : (
              <Video size={20} strokeWidth={1.5} />
            )}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Real-Time Surveillance Integrity Monitor
              </span>
              {isStreaming ? (
                <Badge
                  variant={isTriggerActive ? 'critical' : 'success'}
                  size="sm"
                  icon={
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: isTriggerActive ? '#ef4444' : '#22c55e',
                        display: 'inline-block',
                      }}
                    />
                  }
                >
                  {isTriggerActive ? 'ATTACK DETECTED' : 'LIVE STREAM ACTIVE'}
                </Badge>
              ) : (
                <Badge variant="default" size="sm">
                  STREAM PAUSED
                </Badge>
              )}
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Sub-millisecond frame verification, corner trigger detection & tamper-evident SHA-256 ledger.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <Button
            variant={isStreaming ? 'secondary' : 'primary'}
            size="sm"
            onClick={handleToggleStreaming}
            icon={isStreaming ? <Pause size={14} /> : <Play size={14} />}
          >
            {isStreaming ? 'Pause Stream' : 'Start Live Analysis'}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            icon={<RotateCcw size={14} strokeWidth={1.5} />}
            title="Reset live statistics & frame buffer"
          >
            Reset
          </Button>
        </div>
      </div>

      {cameraError && (
        <div
          style={{
            padding: '10px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            fontSize: '13px',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertTriangle size={16} />
          <span>{cameraError}</span>
        </div>
      )}

      {/* Main Viewport & Forensic Telemetry */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1fr)',
          gap: '20px',
        }}
      >
        {/* Left: Live Video & HUD Viewport */}
        <div
          style={{
            backgroundColor: '#0a0d14',
            border: `1px solid ${
              isTriggerActive ? 'rgba(239, 68, 68, 0.8)' : 'rgba(56, 189, 248, 0.25)'
            }`,
            borderRadius: '12px',
            overflow: 'hidden',
            position: 'relative',
            boxShadow: isTriggerActive
              ? '0 0 25px rgba(239, 68, 68, 0.3)'
              : '0 4px 20px rgba(0, 0, 0, 0.4)',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          }}
        >
          {/* Top Viewport Header */}
          <div
            style={{
              padding: '10px 16px',
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '12px',
              fontFamily: 'monospace',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: isStreaming ? '#22c55e' : '#94a3b8',
                  boxShadow: isStreaming ? '0 0 8px #22c55e' : 'none',
                }}
              />
              <span style={{ color: '#94a3b8' }}>FEED:</span>
              <span style={{ color: '#f8fafc', fontWeight: 600 }}>
                {feedMode === 'webcam' ? 'PHYSICAL WEBCAM' : 'SYNTHETIC CV FEED'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', color: '#94a3b8' }}>
              <span>
                LATENCY:{' '}
                <strong style={{ color: '#38bdf8' }}>
                  {activeFrame ? `${activeFrame.latency_ms.toFixed(2)} ms` : '--'}
                </strong>
              </span>
              <span>
                TRUST:{' '}
                <strong
                  style={{
                    color:
                      (activeFrame?.trust_score ?? 100) > 70
                        ? '#22c55e'
                        : (activeFrame?.trust_score ?? 100) > 40
                        ? '#f59e0b'
                        : '#ef4444',
                  }}
                >
                  {activeFrame ? `${(activeFrame.trust_score * 100).toFixed(0)}%` : '--'}
                </strong>
              </span>
            </div>
          </div>

          {/* Video or Simulated Canvas */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4 / 3',
              maxHeight: '440px',
              backgroundColor: '#05070a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Physical Video element */}
            <video
              ref={videoRef}
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: feedMode === 'webcam' ? 'block' : 'none',
              }}
            />

            {/* Synthetic Canvas element */}
            <canvas
              ref={simCanvasRef}
              width={640}
              height={480}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: feedMode === 'simulated' ? 'block' : 'none',
              }}
            />

            {/* Tactical HUD Overlay */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                pointerEvents: 'none',
              }}
            >
              {/* Corner Reticles */}
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  width: 20,
                  height: 20,
                  borderTop: '2px solid rgba(56, 189, 248, 0.6)',
                  borderLeft: '2px solid rgba(56, 189, 248, 0.6)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 20,
                  height: 20,
                  borderTop: '2px solid rgba(56, 189, 248, 0.6)',
                  borderRight: '2px solid rgba(56, 189, 248, 0.6)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: 12,
                  width: 20,
                  height: 20,
                  borderBottom: '2px solid rgba(56, 189, 248, 0.6)',
                  borderLeft: '2px solid rgba(56, 189, 248, 0.6)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  right: 12,
                  width: 20,
                  height: 20,
                  borderBottom: '2px solid rgba(56, 189, 248, 0.6)',
                  borderRight: '2px solid rgba(56, 189, 248, 0.6)',
                }}
              />

              {/* DETECTED TRIGGER PATCH BOUNDING BOX */}
              {activeFrame?.trigger_patches?.map((patch, idx) => {
                // box is [y1, x1, y2, x2]; the box is sized from patch.size below.
                const [y1, x1] = patch.box;
                const scaleX = 100 / 640;
                const scaleY = 100 / 480;
                const leftPct = x1 * scaleX;
                const topPct = y1 * scaleY;
                const widthPct = Math.max(patch.size[1] * scaleX, 6);
                const heightPct = Math.max(patch.size[0] * scaleY, 6);

                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${widthPct}%`,
                      height: `${heightPct}%`,
                      border: '2px solid #ef4444',
                      backgroundColor: 'rgba(239, 68, 68, 0.25)',
                      boxShadow: '0 0 16px rgba(239, 68, 68, 0.8)',
                      borderRadius: '2px',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: '-22px',
                        left: '0',
                        backgroundColor: '#ef4444',
                        color: '#fff',
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '2px',
                        whiteSpace: 'nowrap',
                        fontFamily: 'monospace',
                      }}
                    >
                      POISON TRIGGER: {patch.patch_type} [{patch.size[0]}x{patch.size[1]}]
                    </div>
                  </motion.div>
                );
              })}

              {/* Bottom HUD Ticker */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: 20,
                  right: 20,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: 'rgba(248, 250, 252, 0.85)',
                  textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                }}
              >
                <span>
                  SHA-256:{' '}
                  <span style={{ color: '#38bdf8' }}>
                    {activeFrame ? `${activeFrame.sha256_hash.substring(0, 16)}…` : 'AWAITING_INPUT'}
                  </span>
                </span>
                <span>FRAME #{activeFrame?.frame_index ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Viewport Action Toolbar */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            {/* Feed Mode Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  stopWebcam();
                  setFeedMode('simulated');
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: feedMode === 'simulated' ? 600 : 500,
                  backgroundColor:
                    feedMode === 'simulated' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: feedMode === 'simulated' ? '#38bdf8' : '#94a3b8',
                  border: `1px solid ${
                    feedMode === 'simulated' ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'
                  }`,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Layers size={13} />
                Synthetic Feed
              </button>

              <button
                type="button"
                onClick={startWebcam}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: feedMode === 'webcam' ? 600 : 500,
                  backgroundColor:
                    feedMode === 'webcam' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: feedMode === 'webcam' ? '#38bdf8' : '#94a3b8',
                  border: `1px solid ${
                    feedMode === 'webcam' ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'
                  }`,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Camera size={13} />
                Physical Webcam
              </button>
            </div>

            {/* ATTACK SIMULATION TOGGLE */}
            <button
              type="button"
              onClick={() => setInjectPoison(prev => !prev)}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: injectPoison ? '#ef4444' : 'rgba(239, 68, 68, 0.15)',
                color: injectPoison ? '#ffffff' : '#f87171',
                border: '1px solid #ef4444',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.15s ease',
              }}
            >
              <Bug size={14} />
              {injectPoison
                ? 'ATTACK INJECTED (30x30 White Square Active)'
                : 'Inject 30x30 Poison Square (Test Detection)'}
            </button>
          </div>
        </div>

        {/* Right: Live Telemetry & Threat Metrics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Live Decision Card */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: `1px solid ${
                isTriggerActive ? '#ef4444' : 'var(--border)'
              }`,
              borderRadius: '12px',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                ZERO-TRUST VERDICT
              </span>
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                CYCLE: {fpsIntervalMs}ms
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  backgroundColor: isTriggerActive
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(34, 197, 94, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isTriggerActive ? '#ef4444' : '#22c55e',
                  border: `1px solid ${isTriggerActive ? '#ef4444' : '#22c55e'}`,
                }}
              >
                {isTriggerActive ? <AlertTriangle size={24} /> : <CheckCircle2 size={24} />}
              </div>
              <div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color: isTriggerActive ? 'var(--critical-text)' : 'var(--success-text)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {activeFrame ? activeFrame.verdict : 'WAITING FOR STREAM'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {activeFrame
                    ? activeFrame.evidence_summary
                    : 'Click "Start Live Analysis" to begin continuous verification.'}
                </div>
              </div>
            </div>

            {/* Metrics Ticker */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                paddingTop: '10px',
                borderTop: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Frames Scanned</span>
                <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {stats.total}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Poison Alerts</span>
                <span
                  style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: stats.poisoned > 0 ? '#ef4444' : 'var(--text-primary)',
                  }}
                >
                  {stats.poisoned}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Avg Latency</span>
                <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--info-text)' }}>
                  {avgLatency} ms
                </span>
              </div>
            </div>
          </div>

          {/* Cryptographic Hash Ledger Card */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Lock size={15} style={{ color: 'var(--text-secondary)' }} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Frame Cryptographic Digest
              </span>
            </div>
            <div
              style={{
                backgroundColor: 'var(--bg-primary)',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: '11px',
                color: 'var(--text-secondary)',
                wordBreak: 'break-all',
              }}
            >
              {activeFrame?.sha256_hash ?? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Computed in Python via SHA-256 for zero-trust stream tamper-detection.
            </span>
          </div>
        </div>
      </div>

      {/* Bottom: Live Stream Filmstrip & Audit Table */}
      <div
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={16} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Live Stream Forensic Audit Filmstrip
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              (Last {recentFrames.length} captured frames)
            </span>
          </div>

          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Pipeline Latency: ~1 ms per frame
          </span>
        </div>

        {recentFrames.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
              border: '1px dashed var(--border)',
              borderRadius: '8px',
            }}
          >
            No live frames recorded yet. Click &quot;Start Live Analysis&quot; above to begin streaming.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '12px',
              maxHeight: '340px',
              overflowY: 'auto',
            }}
          >
            <AnimatePresence>
              {recentFrames.map(frame => {
                const isPoisoned =
                  frame.trigger_detected || frame.verdict.includes('TRIGGER');
                return (
                  <motion.div
                    key={`${frame.frame_index}-${frame.timestamp}`}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      border: `1px solid ${
                        isPoisoned ? '#ef4444' : 'var(--border)'
                      }`,
                      borderRadius: '8px',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {frame.thumbnail && (
                      <div
                        style={{
                          width: '100%',
                          height: '90px',
                          position: 'relative',
                          backgroundColor: '#000',
                        }}
                      >
                        <img
                          src={frame.thumbnail}
                          alt={`Frame ${frame.frame_index}`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                          }}
                        >
                          <Badge
                            variant={isPoisoned ? 'critical' : 'success'}
                            size="sm"
                          >
                            {isPoisoned ? 'POISON' : 'CLEAN'}
                          </Badge>
                        </div>
                      </div>
                    )}

                    <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span>Frame #{frame.frame_index}</span>
                        <span style={{ color: 'var(--info-text)' }}>{frame.latency_ms.toFixed(2)} ms</span>
                      </div>

                      <div
                        style={{
                          fontSize: '10px',
                          fontFamily: 'monospace',
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={frame.sha256_hash}
                      >
                        {frame.sha256_hash.substring(0, 16)}…
                      </div>

                      <div
                        style={{
                          fontSize: '10px',
                          color: isPoisoned ? '#ef4444' : 'var(--text-secondary)',
                          lineHeight: '1.3',
                        }}
                      >
                        {frame.evidence_summary}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};
