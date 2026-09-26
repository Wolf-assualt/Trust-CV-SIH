/**
 * TRUST-CV: Interactive Lineage Provenance Property Graph Renderer
 * High-performance defense DAG visualization with animated evidence-flow particles,
 * state transition pulses, hover telemetry tooltips, and air-gapped theme adaptation.
 * 100% Offline / Zero External Libraries.
 */

class TrustCVGraph {
  constructor(containerId, options = {}) {
    const resolved = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.canvas = null;
    this.container = resolved;
    if (resolved && resolved.tagName === 'CANVAS') {
      this.canvas = resolved;
      this.container = resolved.parentElement || resolved;
    } else if (resolved && typeof resolved.querySelector === 'function') {
      this.canvas = resolved.querySelector('canvas#graph-canvas') || resolved.querySelector('canvas');
    }

    this.options = {
      width: options.width || 800,
      height: options.height || 600,
      onNodeClick: options.onNodeClick || null,
      debug: options.debug !== undefined ? options.debug : Boolean(window.TRUSTCV_GRAPH_DEBUG),
      ...options,
    };

    this.nodes = [];
    this.edges = [];
    this.meta = {};
    this.particles = [];
    this.animFrameId = null;
    this.isVisible = true;
    this.prefersReducedMotion = (typeof window !== 'undefined' && typeof window.matchMedia === 'function') 
      ? Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches) 
      : false;

    this.initDOM();
    this.initObservers();
  }

  sizeCanvas() {
    const w = this.options.width || 800;
    const h = this.options.height || 600;
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
    }
    return { width: w, height: h };
  }

  initDOM() {
    if (!this.container) return;

    this.sizeCanvas();

    // Preserve any existing hidden legacy canvas for backward compatibility tests
    const existingCanvas = this.canvas || this.container.querySelector('canvas#graph-canvas');
    if (existingCanvas) {
      this.canvas = existingCanvas;
      this.sizeCanvas();
      existingCanvas.style.display = 'none';
    }

    // Remove any previous SVG or tooltip
    const oldSvg = this.container.querySelector('svg.trustcv-graph-svg');
    if (oldSvg) {
      if (typeof oldSvg.remove === 'function') oldSvg.remove();
      else if (oldSvg.parentNode) oldSvg.parentNode.removeChild(oldSvg);
    }
    const oldTip = this.container.querySelector('.graph-tooltip');
    if (oldTip) {
      if (typeof oldTip.remove === 'function') oldTip.remove();
      else if (oldTip.parentNode) oldTip.parentNode.removeChild(oldTip);
    }

    // Create Tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'graph-tooltip';
    this.container.appendChild(this.tooltip);

    // Create SVG Canvas
    const svgNS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(svgNS, 'svg');
    this.svg.classList.add('trustcv-graph-svg');
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    this.svg.setAttribute('viewBox', `0 0 ${this.options.width} ${this.options.height}`);
    this.svg.style.overflow = 'visible';

    // SVG Defs: Gradients, Markers, and Glow Filters
    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `
      <marker id="arrow-neutral" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#64748b" />
      </marker>
      <marker id="arrow-cyan" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#06b6d4" />
      </marker>
      <marker id="arrow-green" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
      </marker>
      <marker id="arrow-danger" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#ef4444" />
      </marker>
      <marker id="arrow-amber" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b" />
      </marker>
      
      <linearGradient id="grad-cyan-green" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#06b6d4" />
        <stop offset="100%" stop-color="#10b981" />
      </linearGradient>
      <linearGradient id="grad-danger" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#ef4444" />
        <stop offset="100%" stop-color="#b91c1c" />
      </linearGradient>
      <linearGradient id="grad-amber" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#f59e0b" />
        <stop offset="100%" stop-color="#d97706" />
      </linearGradient>
    `;
    this.svg.appendChild(defs);

    // Groups
    this.edgesGroup = document.createElementNS(svgNS, 'g');
    this.edgesGroup.setAttribute('class', 'graph-edges-layer');
    this.svg.appendChild(this.edgesGroup);

    this.particlesGroup = document.createElementNS(svgNS, 'g');
    this.particlesGroup.setAttribute('class', 'graph-particles-layer');
    this.svg.appendChild(this.particlesGroup);

    this.nodesGroup = document.createElementNS(svgNS, 'g');
    this.nodesGroup.setAttribute('class', 'graph-nodes-layer');
    this.svg.appendChild(this.nodesGroup);

    this.container.appendChild(this.svg);
  }

  initObservers() {
    // Visibility Observer to pause particle loop when offscreen
    if (window.IntersectionObserver && this.container) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          this.isVisible = entry.isIntersecting;
          if (this.isVisible) {
            this.startParticleLoop();
          } else {
            this.stopParticleLoop();
          }
        });
      }, { threshold: 0.1 });
      observer.observe(this.container);
    }

    // Tab visibility change
    document.addEventListener('visibilitychange', () => {
      this.isVisible = !document.hidden;
      if (this.isVisible) {
        this.startParticleLoop();
      } else {
        this.stopParticleLoop();
      }
    });

    // Match media reduced motion listener
    const mq = (typeof window !== 'undefined' && typeof window.matchMedia === 'function') 
      ? window.matchMedia('(prefers-reduced-motion: reduce)') 
      : null;
    if (mq && mq.addEventListener) {
      mq.addEventListener('change', (e) => {
        this.prefersReducedMotion = e.matches;
        if (this.prefersReducedMotion) this.stopParticleLoop();
        else this.startParticleLoop();
      });
    }
  }

  setData(nodes = [], edges = [], meta = {}) {
    this.nodes = this.dedupeNodes(nodes);
    this.edges = this.filterEdges(this.nodes, edges);
    this.meta = meta;
    this.render();
  }

  dedupeNodes(nodes) {
    const seen = new Set();
    const unique = [];
    (nodes || []).forEach((node, idx) => {
      if (!node) return;
      let id = node.id != null && String(node.id).length ? String(node.id) : '';
      if (!id) {
        id = node.digest || node.canonical_identity || `node_${idx}`;
        node = { ...node, id };
      }
      if (seen.has(id)) return;
      seen.add(id);
      unique.push(node);
    });
    return unique;
  }

  filterEdges(nodes, edges) {
    const ids = new Set(nodes.map(n => n.id));
    return (edges || []).filter(e => {
      const src = e.source_id || e.source;
      const tgt = e.target_id || e.target;
      return ids.has(src) && ids.has(tgt);
    });
  }

  edgeWeight(edge) {
    if (typeof edge.weight === 'number' && edge.weight > 0) return edge.weight;
    const t = String(edge.type || edge.edge_type || '').toUpperCase();
    if (t.includes('TRAINED') || t.includes('GENERATED') || t.includes('SIGNED') || t.includes('SEAL') || t.includes('DNA')) return 1.45;
    if (t.includes('CONTAIN') || t.includes('AUTHORED') || t.includes('PROVIDED') || t.includes('VERSION')) return 1.15;
    if (t.includes('FLAG') || t.includes('QUARANTINE') || t.includes('VETO') || t.includes('ABOUT')) return 0.55;
    return 0.9;
  }

  typeColumn(type, width) {
    const t = String(type || '').toUpperCase();
    if (t.includes('CONTRIBUTOR') || t === 'ACTOR') return width * 0.10;
    if (t.includes('DATASET') || t.includes('SAMPLE') || t.includes('BATCH') || t.includes('INGEST')) return width * 0.28;
    if (t.includes('MODEL') || t.includes('WEIGHT') || t.includes('FINGERPRINT')) return width * 0.46;
    if (t.includes('INFER') || t.includes('PREDICT') || t.includes('DNA')) return width * 0.64;
    if (t.includes('QUARANTINE') || t.includes('VETO') || t.includes('INCIDENT')) return width * 0.46;
    if (t.includes('EVIDENCE') || t.includes('FUSION') || t.includes('ASSESS') || t.includes('FINDING') || t.includes('REPORT')) return width * 0.84;
    return width * 0.50;
  }

  /**
   * Force-directed layout: unique circle/column seeds, then many-body +
   * weighted links + centering. Never seed every node at (0,0) or a shared slot.
   */
  computeLayout(nodes, edges, width, height) {
    const n = nodes.length;
    const simNodes = nodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, n);
      const radius = Math.min(width, height) * 0.32;
      const jitter = ((i * 17) % 13) - 6;
      return {
        id: node.id,
        type: node.node_type || node.nodeType || '',
        x: width / 2 + radius * Math.cos(angle) + jitter,
        y: height / 2 + radius * Math.sin(angle) + (((i * 31) % 11) - 5),
        vx: 0,
        vy: 0,
      };
    });

    // Bias initial x toward lineage columns, and spread y within a column.
    const byCol = {};
    simNodes.forEach(sn => {
      const col = Math.round(this.typeColumn(sn.type, width));
      sn.col = col;
      (byCol[col] || (byCol[col] = [])).push(sn);
    });
    Object.keys(byCol).forEach(col => {
      const list = byCol[col];
      const spacing = Math.min(88, (height - 90) / Math.max(1, list.length));
      const startY = (height - (list.length - 1) * spacing) / 2;
      list.forEach((sn, i) => {
        sn.x = Number(col) + ((i % 2 === 0) ? -8 : 8);
        sn.y = startY + i * spacing;
      });
    });

    const byId = {};
    simNodes.forEach(sn => { byId[sn.id] = sn; });
    const links = [];
    (edges || []).forEach(edge => {
      const src = byId[edge.source_id || edge.source];
      const tgt = byId[edge.target_id || edge.target];
      if (src && tgt && src !== tgt) {
        links.push({ source: src, target: tgt, weight: this.edgeWeight(edge) });
      }
    });

    const charge = -220;
    const linkDistance = 110;
    const ticks = 300;
    const alphaDecay = 0.02;
    let alpha = 1;

    for (let tick = 0; tick < ticks; tick++) {
      alpha *= (1 - alphaDecay);

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let dx = simNodes[i].x - simNodes[j].x;
          let dy = simNodes[i].y - simNodes[j].y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 1) {
            dist2 = 1;
            dx = 0.5;
            dy = 0.5;
          }
          const dist = Math.sqrt(dist2);
          const force = (charge * alpha) / dist2;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          simNodes[i].vx += fx;
          simNodes[i].vy += fy;
          simNodes[j].vx -= fx;
          simNodes[j].vy -= fy;
          // Collision: keep node radii from stacking
          const minDist = 46;
          if (dist < minDist) {
            const push = (minDist - dist) * 0.08 * alpha;
            simNodes[i].vx += (dx / dist) * push;
            simNodes[i].vy += (dy / dist) * push;
            simNodes[j].vx -= (dx / dist) * push;
            simNodes[j].vy -= (dy / dist) * push;
          }
        }
      }

      links.forEach(link => {
        let dx = link.target.x - link.source.x;
        let dy = link.target.y - link.source.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const desired = linkDistance / link.weight;
        const k = ((dist - desired) / dist) * 0.06 * alpha * link.weight;
        const fx = dx * k;
        const fy = dy * k;
        link.source.vx += fx;
        link.source.vy += fy;
        link.target.vx -= fx;
        link.target.vy -= fy;
      });

      const cx = width / 2;
      const cy = height / 2;
      simNodes.forEach(sn => {
        sn.vx += (sn.col - sn.x) * 0.02 * alpha;
        sn.vx += (cx - sn.x) * 0.004 * alpha;
        sn.vy += (cy - sn.y) * 0.008 * alpha;
        sn.vx *= 0.85;
        sn.vy *= 0.85;
        sn.x += sn.vx;
        sn.y += sn.vy;
        sn.x = Math.max(36, Math.min(width - 36, sn.x));
        sn.y = Math.max(40, Math.min(height - 40, sn.y));
      });
    }

    const positions = {};
    simNodes.forEach(sn => {
      positions[sn.id] = { x: sn.x, y: sn.y };
    });
    return positions;
  }

  logLayoutDebug(positions) {
    if (!this.options.debug && !window.TRUSTCV_GRAPH_DEBUG) return;
    const coords = Object.keys(positions).map(id => ({
      id,
      x: Number(positions[id].x.toFixed(1)),
      y: Number(positions[id].y.toFixed(1)),
    }));
    const uniqueSlots = new Set(coords.map(c => `${Math.round(c.x / 4)}:${Math.round(c.y / 4)}`));
    console.debug('[TRUST-CV graph]', {
      nodes: this.nodes.length,
      edges: this.edges.length,
      uniquePositionSlots: uniqueSlots.size,
      positions: coords,
    });
  }

  render() {
    if (!this.container || !this.svg) return;

    this.sizeCanvas();
    this.stopParticleLoop();
    this.edgesGroup.innerHTML = '';
    this.particlesGroup.innerHTML = '';
    this.nodesGroup.innerHTML = '';
    this.particles = [];

    const width = this.options.width;
    const height = this.options.height;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const svgNS = 'http://www.w3.org/2000/svg';

    if (!this.nodes || this.nodes.length === 0) {
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', width / 2);
      text.setAttribute('y', height / 2);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', 'var(--text-dim)');
      text.setAttribute('font-family', 'var(--font-mono)');
      text.setAttribute('font-size', '12');
      text.textContent = 'NO ACTIVE PROVENANCE LINEAGE ATTACHED';
      this.nodesGroup.appendChild(text);
      return;
    }

    const isTamper = this.meta.isTamper || this.nodes.some(n => n.node_type === 'QUARANTINE' || n.status === 'FAILED' || n.status === 'TAMPERED');
    const isDrift = this.meta.isDrift || this.nodes.some(n => n.status === 'REVIEW' || n.status === 'DRIFT');

    const positions = this.computeLayout(this.nodes, this.edges, width, height);
    this.logLayoutDebug(positions);

    // Draw Edges & Prepare Paths for Particle Simulation
    this.edges.forEach((edge, edgeIdx) => {
      const srcId = edge.source_id || edge.source;
      const tgtId = edge.target_id || edge.target;
      const src = positions[srcId];
      const tgt = positions[tgtId];

      if (!src || !tgt) return;

      const path = document.createElementNS(svgNS, 'path');
      
      // Calculate curved control points for smooth aerospace DAG aesthetics
      let d;
      const isQuarantineEdge = (edge.type === 'QUARANTINE_BRANCH' || tgtId.includes('ev_integrity') || tgtId.includes('quarantine') || srcId.includes('quarantine'));
      
      if (isQuarantineEdge) {
        // Downward branch curve
        const midX = (src.x + tgt.x) / 2;
        d = `M ${src.x} ${src.y} Q ${src.x} ${tgt.y} ${tgt.x} ${tgt.y}`;
      } else if (Math.abs(src.y - tgt.y) < 10) {
        // Straight horizontal edge
        d = `M ${src.x} ${src.y} L ${tgt.x} ${tgt.y}`;
      } else {
        // Smooth S-Curve
        const dx = (tgt.x - src.x) * 0.5;
        d = `M ${src.x} ${src.y} C ${src.x + dx} ${src.y}, ${tgt.x - dx} ${tgt.y}, ${tgt.x} ${tgt.y}`;
      }

      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('id', `edge-path-${edgeIdx}`);

      // Edge styling based on scenario state
      let edgeColor = '#475569';
      let markerEnd = 'url(#arrow-neutral)';
      let isInterrupted = false;

      if (isTamper) {
        if (isQuarantineEdge) {
          edgeColor = '#ef4444';
          markerEnd = 'url(#arrow-danger)';
          path.setAttribute('stroke-dasharray', '4 4');
        } else if (srcId === 'ds_recon_01' || srcId === 'model_landcover') {
          // Interrupted / Downstream warning flow
          edgeColor = '#f59e0b';
          markerEnd = 'url(#arrow-amber)';
          path.setAttribute('stroke-dasharray', '3 3');
          isInterrupted = true;
        } else {
          edgeColor = '#06b6d4';
          markerEnd = 'url(#arrow-cyan)';
        }
      } else if (isDrift) {
        edgeColor = '#f59e0b';
        markerEnd = 'url(#arrow-amber)';
      } else {
        edgeColor = '#06b6d4';
        markerEnd = 'url(#arrow-green)';
      }

      path.setAttribute('stroke', edgeColor);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('marker-end', markerEnd);
      path.setAttribute('opacity', '0.85');

      this.edgesGroup.appendChild(path);

      // Register Particle System on Path
      const totalLen = (typeof path.getTotalLength === 'function') ? path.getTotalLength() : 100;
      if (!isInterrupted && !this.prefersReducedMotion && totalLen > 0) {
        const particle = {
          pathElement: path,
          length: totalLen,
          t: (edgeIdx * 0.25) % 1.0,
          speed: isQuarantineEdge ? 0.007 : 0.005,
          color: isQuarantineEdge ? '#ef4444' : (isDrift ? '#f59e0b' : '#38bdf8'),
          radius: isQuarantineEdge ? 3.5 : 3.0,
          isQuarantine: isQuarantineEdge,
        };

        // Create SVG circle particle
        const pCircle = document.createElementNS(svgNS, 'circle');
        pCircle.setAttribute('r', particle.radius);
        pCircle.setAttribute('fill', particle.color);
        pCircle.setAttribute('opacity', '0.9');
        pCircle.style.filter = `drop-shadow(0 0 4px ${particle.color})`;

        this.particlesGroup.appendChild(pCircle);
        particle.element = pCircle;
        this.particles.push(particle);
      }
    });

    // Draw Nodes
    this.nodes.forEach(node => {
      const pos = positions[node.id];
      if (!pos) return;

      const type = (node.node_type || 'NODE').toUpperCase();
      const isQuarantineNode = (type === 'QUARANTINE' || node.status === 'QUARANTINED');
      const isDownstreamAffected = isTamper && (type === 'MODEL' || type === 'INFERENCE');

      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'graph-node-group');
      g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      g.style.cursor = 'pointer';

      // Colors and State styling
      let strokeColor = '#38bdf8';
      let fillColor = 'var(--bg-elevated)';
      let badgeText = type;
      let statusTag = 'VERIFIED';
      let statusClass = 'status-verified';

      if (type === 'CONTRIBUTOR') {
        strokeColor = 'var(--accent-indigo)';
        badgeText = 'CONTRIBUTOR';
        statusTag = 'AUTHENTIC';
      } else if (type === 'DATASET') {
        if (isTamper && this.meta.scenario === 'tamper_b04') {
          strokeColor = '#ef4444';
          fillColor = 'var(--status-danger-bg)';
          badgeText = 'TAMPERED';
          statusTag = 'HARD VETO';
          statusClass = 'status-failed';
        } else {
          strokeColor = '#06b6d4';
          badgeText = 'DATASET';
          statusTag = 'MERKLE PASS';
        }
      } else if (type === 'MODEL') {
        if (isDownstreamAffected) {
          strokeColor = '#f59e0b';
          badgeText = 'REVIEW';
          statusTag = 'REQUIRES REVIEW';
          statusClass = 'status-review';
        } else if (isTamper && this.meta.scenario === 'model_tamper') {
          strokeColor = '#ef4444';
          fillColor = 'var(--status-danger-bg)';
          badgeText = 'MUTATED';
          statusTag = 'WEIGHT MISMATCH';
          statusClass = 'status-failed';
        } else {
          strokeColor = '#3b82f6';
          badgeText = 'MODEL';
          statusTag = 'WEIGHTS SEALED';
        }
      } else if (type === 'INFERENCE') {
        if (isDownstreamAffected) {
          strokeColor = '#f59e0b';
          badgeText = 'REVIEW';
          statusTag = 'CHAIN FLAGGED';
          statusClass = 'status-review';
        } else {
          strokeColor = '#10b981';
          badgeText = 'INFERENCE';
          statusTag = 'DNA MONOTONIC';
        }
      } else if (type === 'EVIDENCE') {
        if (isDrift) {
          strokeColor = '#f59e0b';
          fillColor = 'var(--status-warning-bg)';
          badgeText = 'DRIFT';
          statusTag = 'REVIEW REQUIRED';
          statusClass = 'status-review';
        } else {
          strokeColor = '#10b981';
          fillColor = 'var(--status-success-bg)';
          badgeText = 'VERIFIED';
          statusTag = 'ACCEPTED';
        }
      } else if (isQuarantineNode) {
        strokeColor = '#ef4444';
        fillColor = 'var(--status-danger-bg)';
        badgeText = 'QUARANTINE';
        statusTag = 'CONTAINED';
        statusClass = 'status-failed';
      }

      // Outer Halo Ring (for Downstream Alert or Pulse)
      if (isDownstreamAffected) {
        const warningRing = document.createElementNS(svgNS, 'circle');
        warningRing.setAttribute('r', '24');
        warningRing.setAttribute('fill', 'none');
        warningRing.setAttribute('stroke', '#f59e0b');
        warningRing.setAttribute('stroke-width', '1.5');
        warningRing.setAttribute('stroke-dasharray', '3 3');
        warningRing.setAttribute('opacity', '0.8');
        g.appendChild(warningRing);
      } else if (isQuarantineNode) {
        const dangerRing = document.createElementNS(svgNS, 'circle');
        dangerRing.setAttribute('r', '24');
        dangerRing.setAttribute('fill', 'none');
        dangerRing.setAttribute('stroke', '#ef4444');
        dangerRing.setAttribute('stroke-width', '1.5');
        dangerRing.setAttribute('class', 'node-incident-pulse');
        g.appendChild(dangerRing);
      }

      // Main Node Circle
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('r', '17');
      circle.setAttribute('fill', fillColor);
      circle.setAttribute('stroke', strokeColor);
      circle.setAttribute('stroke-width', '2.5');
      circle.classList.add(statusClass);
      
      // Trigger subtle pulse once on render completion
      if (!this.prefersReducedMotion) {
        circle.classList.add('node-pulsing');
      }

      // Node Icon / Letter Marker
      const iconText = document.createElementNS(svgNS, 'text');
      iconText.setAttribute('text-anchor', 'middle');
      iconText.setAttribute('dominant-baseline', 'central');
      iconText.setAttribute('fill', strokeColor);
      iconText.setAttribute('font-family', 'var(--font-mono)');
      iconText.setAttribute('font-size', '10');
      iconText.setAttribute('font-weight', '800');
      iconText.textContent = type.substring(0, 2);

      // Node Bottom Label
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('y', '30');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', 'var(--text-primary)');
      label.setAttribute('font-family', 'var(--font-mono)');
      label.setAttribute('font-size', '10');
      label.setAttribute('font-weight', '600');
      label.textContent = (node.label || node.id || '').substring(0, 18);

      // Node Top Type Tag
      const typeLabel = document.createElementNS(svgNS, 'text');
      typeLabel.setAttribute('y', '-24');
      typeLabel.setAttribute('text-anchor', 'middle');
      typeLabel.setAttribute('fill', strokeColor);
      typeLabel.setAttribute('font-family', 'var(--font-mono)');
      typeLabel.setAttribute('font-size', '8');
      typeLabel.setAttribute('font-weight', '800');
      typeLabel.setAttribute('letter-spacing', '0.5px');
      typeLabel.textContent = badgeText;

      g.appendChild(circle);
      g.appendChild(iconText);
      g.appendChild(label);
      g.appendChild(typeLabel);

      // Node Hover Interaction: Tactical Floating Tooltip
      g.addEventListener('mouseenter', (e) => {
        this.showTooltip(node, type, statusTag, strokeColor, pos);
      });

      g.addEventListener('mouseleave', () => {
        this.hideTooltip();
      });

      // Node Click Interaction: Open Technical Drawer / Callback
      g.addEventListener('click', () => {
        if (this.options.onNodeClick) {
          this.options.onNodeClick(node);
        } else {
          this.openNodeDetails(node, type, statusTag);
        }
      });

      this.nodesGroup.appendChild(g);
    });

    this.startParticleLoop();
  }

  showTooltip(node, type, statusTag, color, pos) {
    if (!this.tooltip || !this.container) return;

    const digest = node.digest || (node.id ? node.id.substring(0, 16) + '...' : 'SEALED');
    const upstream = node.upstream || 'Root Contributor Ground Station';
    const downstream = node.downstream || 'Inference Execution Pipeline';

    this.tooltip.innerHTML = `
      <div class="graph-tooltip-title" style="color: ${color};">
        <span>${type} // ${escapeHtml(node.label || node.id)}</span>
        <span class="badge-tag" style="border: 1px solid ${color}; color: ${color}; font-size: 8px;">${statusTag}</span>
      </div>
      <div class="graph-tooltip-row">
        <span class="graph-tooltip-label">Asset ID:</span>
        <span class="graph-tooltip-val">${escapeHtml(node.id || 'N/A')}</span>
      </div>
      <div class="graph-tooltip-row">
        <span class="graph-tooltip-label">SHA-256 Digest:</span>
        <span class="graph-tooltip-val" style="font-family: var(--font-mono); font-size: 9px;">${digest}</span>
      </div>
      <div class="graph-tooltip-row">
        <span class="graph-tooltip-label">Lineage:</span>
        <span class="graph-tooltip-val" style="font-size: 9px;">${type === 'CONTRIBUTOR' ? 'Primary Ingestion Source' : 'Linked Upstream Verified'}</span>
      </div>
    `;

    // Position Tooltip
    const rect = this.container.getBoundingClientRect();
    const scaleX = rect.width / this.options.width;
    const scaleY = rect.height / this.options.height;

    const px = pos.x * scaleX;
    const py = pos.y * scaleY;

    this.tooltip.style.left = `${px}px`;
    this.tooltip.style.top = `${py}px`;
    this.tooltip.classList.add('visible');
  }

  hideTooltip() {
    if (this.tooltip) {
      this.tooltip.classList.remove('visible');
    }
  }

  openNodeDetails(node, type, statusTag) {
    // Open the Subsystem Drawer and populate with node telemetry
    const drawer = document.getElementById('drawer-panel');
    const backdrop = document.getElementById('drawer-backdrop');
    const drawerTitle = drawer ? drawer.querySelector('.drawer-title') : null;
    const drawerBody = document.getElementById('drawer-body') || (drawer ? drawer.querySelector('.drawer-body') : null);

    if (drawer && backdrop) {
      if (drawerTitle) drawerTitle.textContent = `Provenance Node // ${type}: ${node.label || node.id}`;
      if (drawerBody) {
        drawerBody.innerHTML = `
          <div class="telemetry-box">
            <div class="telemetry-box-title">Cryptographic Node Telemetry</div>
            <table class="meta-table">
              <tr><td>Node Type:</td><td><strong>${type}</strong></td></tr>
              <tr><td>Node Identifier:</td><td><code>${escapeHtml(node.id)}</code></td></tr>
              <tr><td>Assurance Status:</td><td><span class="badge-tag badge-health-ok">${statusTag}</span></td></tr>
              <tr><td>Canonical Seal:</td><td><code>RFC 8785 JSON SHA-256</code></td></tr>
              <tr><td>Digital Signature:</td><td><code>Ed25519 (Air-Gapped Local CA)</code></td></tr>
            </table>
          </div>
          <div class="telemetry-box">
            <div class="telemetry-box-title">Raw Subsystem Properties</div>
            <pre style="font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); background: var(--bg-terminal); padding: 0.75rem; border-radius: 4px; overflow-x: auto;">${escapeHtml(JSON.stringify(node, null, 2))}</pre>
          </div>
        `;
      }
      backdrop.classList.add('active');
      drawer.classList.add('active');
    }
  }

  startParticleLoop() {
    if (this.animFrameId || this.prefersReducedMotion || !this.isVisible) return;

    const animate = () => {
      if (!this.isVisible) {
        this.animFrameId = null;
        return;
      }

      this.particles.forEach(p => {
        p.t += p.speed;
        if (p.t > 1.0) p.t = 0.0;

        try {
          const pt = p.pathElement.getPointAtLength(p.t * p.length);
          p.element.setAttribute('cx', pt.x);
          p.element.setAttribute('cy', pt.y);
        } catch (e) {
          // Ignore SVG measurement glitches during tab switch
        }
      });

      const reqAnim = (typeof window !== 'undefined' && window.requestAnimationFrame) 
        ? window.requestAnimationFrame 
        : (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null);
      if (reqAnim) {
        this.animFrameId = reqAnim(animate);
      }
    };

    const reqAnim = (typeof window !== 'undefined' && window.requestAnimationFrame) 
      ? window.requestAnimationFrame 
      : (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null);
    if (reqAnim) {
      this.animFrameId = reqAnim(animate);
    }
  }

  stopParticleLoop() {
    if (this.animFrameId) {
      const cancelAnim = (typeof window !== 'undefined' && window.cancelAnimationFrame) 
        ? window.cancelAnimationFrame 
        : (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : null);
      if (cancelAnim) cancelAnim(this.animFrameId);
      this.animFrameId = null;
    }
  }

  animateFlow() {
    this.startParticleLoop();
  }

  loadGraphData(data) {
    if (data && (data.nodes || data.edges)) {
      this.setData(data.nodes || [], data.edges || []);
    }
  }
}

// Backward compatibility alias for legacy test assertions
class ProvenanceGraphRenderer extends TrustCVGraph {}

window.TrustCVGraph = TrustCVGraph;
window.ProvenanceGraphRenderer = ProvenanceGraphRenderer;
