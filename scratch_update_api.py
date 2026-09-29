fp = 'frontend/src/services/api.ts'
with open(fp, 'r') as f:
    text = f.read()

types_to_add = '''
export interface StreamTriggerPatch {
  corner?: string;
  region?: string;
  coordinates?: number[];
  patch_size?: number;
  description: string;
}

export interface StreamFrameResponse {
  frame_index: number;
  sha256_hash: string;
  timestamp: string;
  result: string;
  integrity_status: string;
  trust_status: string;
  action: string;
  trust_score: number;
  latency_ms: number;
  trigger_patches: StreamTriggerPatch[];
  evidence: string[];
}
'''

methods_to_add = '''
  // ── Real-Time Live Stream Inspection ───────────────────────────────────────

  /** Inspect a live camera / video stream frame in real time. */
  async analyzeStreamFrame(
    frameBase64: string,
    frameIndex: number,
    source: string = 'webcam',
  ): Promise<StreamFrameResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/stream/analyze_frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frame_data: frameBase64,
          frame_index: frameIndex,
          source,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope: ApiResponse<StreamFrameResponse> = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Stream frame analysis failed:', e);
      return null;
    }
  }

  /** Reset the live stream buffer on the backend. */
  async resetStream(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/stream/reset`, { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }
'''

# Add types before ApiService class
class_idx = text.find('export class ApiService')
assert class_idx != -1
text = text[:class_idx] + types_to_add + '\n' + text[class_idx:]

# Find last method closing brace before 'export const apiService'
service_end_marker = 'export const apiService = new ApiService();'
last_marker_idx = text.rfind(service_end_marker)
assert last_marker_idx != -1

# Insert methods before the last closing brace of ApiService
last_brace = text.rfind('}', 0, last_marker_idx)
text = text[:last_brace] + methods_to_add + '\n}\n\n' + service_end_marker + '\n'

with open(fp, 'w') as f:
    f.write(text)

print('Updated api.ts successfully!')
