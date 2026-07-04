// Parameter Automation Engine
// Keyframe interpolation, camera flights, audio-driven modulation, JSON export/import

export type CurveType = 'linear' | 'smoothstep' | 'step';
export type LoopMode = 'off' | 'loop' | 'pingpong';
export type AutomationMode = 'manual' | 'automation' | 'audio';

type Keyframe = { time: number; value: number; curve: CurveType };

type Track = {
  param: string;
  keyframes: Keyframe[];
  loop: LoopMode;
  speed: number;
  offset: number;
  duration: number;
};

type AudioBinding = {
  source: 'amplitude' | 'fft';
  fftBand: number;
  min: number;
  max: number;
  smoothing: number;
};

type CameraKeyframe = {
  time: number;
  angleX: number;
  angleY: number;
  radius: number;
};

type CameraTrack = { keyframes: CameraKeyframe[] };

export type AudioData = {
  timeDataL: Float32Array;
  timeDataR: Float32Array;
  fftDataL: Float32Array;
  fftDataR: Float32Array;
};

export type CameraState = { angleX: number; angleY: number; radius: number };

export class AutomationEngine {
  private tracks = new Map<string, Track>();
  private modes = new Map<string, AutomationMode>();
  private audioBindings = new Map<string, AudioBinding>();
  duration: number = 60;
  startTime: number = 0;
  playing: boolean = false;

  cameraTrack: CameraTrack | null = null;
  cameraRecording: boolean = false;
  private cameraRecordStart: number = 0;
  private _smoothedAudio = new Map<string, number>();

  addTrack(param: string): void {
    this.tracks.set(param, {
      param,
      keyframes: [],
      loop: 'off',
      speed: 1.0,
      offset: 0,
      duration: this.duration,
    });
    this.modes.set(param, 'manual');
  }

  addKeyframe(
    param: string,
    time: number,
    value: number,
    curve: CurveType = 'linear'
  ): void {
    const track = this.tracks.get(param);
    if (!track) return;
    track.keyframes.push({ time, value, curve });
    track.keyframes.sort((a, b) => a.time - b.time);
  }

  removeKeyframe(param: string, index: number): void {
    this.tracks.get(param)?.keyframes.splice(index, 1);
  }

  setTrackLoop(param: string, loopMode: LoopMode): void {
    const t = this.tracks.get(param);
    if (t) t.loop = loopMode;
  }

  setTrackSpeed(param: string, speed: number): void {
    const t = this.tracks.get(param);
    if (t) t.speed = speed;
  }

  setTrackOffset(param: string, offset: number): void {
    const t = this.tracks.get(param);
    if (t) t.offset = offset;
  }

  setMode(param: string, mode: AutomationMode): void {
    this.modes.set(param, mode);
  }

  setAudioBinding(param: string, binding: Partial<AudioBinding>): void {
    this.audioBindings.set(param, {
      source: binding.source ?? 'amplitude',
      fftBand: binding.fftBand ?? 0,
      min: binding.min ?? 0,
      max: binding.max ?? 1,
      smoothing: binding.smoothing ?? 0.8,
    });
  }

  private _findKeyframePair(
    keyframes: Keyframe[],
    t: number
  ): { a: Keyframe; b: Keyframe; frac: number } | null {
    if (keyframes.length === 0) return null;
    if (keyframes.length === 1)
      return { a: keyframes[0]!, b: keyframes[0]!, frac: 0 };

    let lo = 0,
      hi = keyframes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((keyframes[mid]?.time ?? 0) <= t) lo = mid;
      else hi = mid - 1;
    }
    const a = keyframes[lo]!;
    const b = lo + 1 < keyframes.length ? keyframes[lo + 1]! : a;
    if (a === b) return { a, b, frac: 0 };
    const frac = (t - a.time) / (b.time - a.time);
    return { a, b, frac: Math.max(0, Math.min(1, frac)) };
  }

  private _interpolate(
    aVal: number,
    bVal: number,
    frac: number,
    curve: CurveType
  ): number {
    switch (curve) {
      case 'step':
        return aVal;
      case 'smoothstep': {
        const t = frac * frac * (3 - 2 * frac);
        return aVal + (bVal - aVal) * t;
      }
      case 'linear':
      default:
        return aVal + (bVal - aVal) * frac;
    }
  }

  private _resolveTrackTime(track: Track, globalTime: number): number {
    let t = (globalTime + track.offset) * track.speed;
    const dur = track.duration;
    if (dur <= 0) return t;
    switch (track.loop) {
      case 'loop':
        t = t % dur;
        if (t < 0) t += dur;
        break;
      case 'pingpong': {
        const cycle = t / dur;
        const isOdd = Math.floor(cycle) % 2 === 1;
        t = t % dur;
        if (t < 0) t += dur;
        if (isOdd) t = dur - t;
        break;
      }
      default:
        t = Math.max(0, Math.min(dur, t));
    }
    return t;
  }

  private _computeRMS(
    timeDataL: Float32Array,
    timeDataR: Float32Array
  ): number {
    let sum = 0;
    const len = timeDataL.length;
    for (let i = 0; i < len; i++) {
      const l = timeDataL[i] ?? 0;
      const r = timeDataR[i] ?? 0;
      sum += l * l + r * r;
    }
    return Math.sqrt(sum / (len * 2));
  }

  private _readFFTBand(
    fftL: Float32Array,
    fftR: Float32Array,
    band: number
  ): number {
    const idx = Math.min(band, fftL.length - 1);
    const avgDb = ((fftL[idx] ?? -100) + (fftR[idx] ?? -100)) / 2;
    return Math.max(0, Math.min(1, (avgDb + 100) / 100));
  }

  evaluate(
    audioContextTime: number,
    audioData: AudioData | null
  ): Record<string, number> {
    const elapsed = audioContextTime - this.startTime;
    const result: Record<string, number> = {};

    for (const [param, mode] of this.modes) {
      switch (mode) {
        case 'automation': {
          const track = this.tracks.get(param);
          if (!track || track.keyframes.length === 0) break;
          const t = this._resolveTrackTime(track, elapsed);
          const pair = this._findKeyframePair(track.keyframes, t);
          if (pair)
            result[param] = this._interpolate(
              pair.a.value,
              pair.b.value,
              pair.frac,
              pair.a.curve
            );
          break;
        }
        case 'audio': {
          const binding = this.audioBindings.get(param);
          if (!binding || !audioData) break;
          const raw =
            binding.source === 'amplitude'
              ? this._computeRMS(audioData.timeDataL, audioData.timeDataR)
              : this._readFFTBand(
                  audioData.fftDataL,
                  audioData.fftDataR,
                  binding.fftBand
                );
          const prev = this._smoothedAudio.get(param) ?? 0;
          const smoothed = prev + (raw - prev) * (1 - binding.smoothing);
          this._smoothedAudio.set(param, smoothed);
          result[param] = binding.min + smoothed * (binding.max - binding.min);
          break;
        }
        default:
          break;
      }
    }
    return result;
  }

  startCameraRecord(audioContextTime: number): void {
    this.cameraTrack = { keyframes: [] };
    this.cameraRecording = true;
    this.cameraRecordStart = audioContextTime;
  }

  recordCameraFrame(
    audioContextTime: number,
    orbitAngleX: number,
    orbitAngleY: number,
    orbitRadius: number
  ): void {
    if (!this.cameraRecording || !this.cameraTrack) return;
    this.cameraTrack.keyframes.push({
      time: audioContextTime - this.cameraRecordStart,
      angleX: orbitAngleX,
      angleY: orbitAngleY,
      radius: orbitRadius,
    });
  }

  stopCameraRecord(): void {
    this.cameraRecording = false;
  }

  evaluateCamera(audioContextTime: number): CameraState | null {
    if (!this.cameraTrack || this.cameraTrack.keyframes.length === 0)
      return null;
    const t = audioContextTime - this.startTime;
    const kfs = this.cameraTrack.keyframes;

    let lo = 0,
      hi = kfs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((kfs[mid]?.time ?? 0) <= t) lo = mid;
      else hi = mid - 1;
    }
    const a = kfs[lo]!;
    const b = lo + 1 < kfs.length ? kfs[lo + 1]! : a;
    if (a === b)
      return { angleX: a.angleX, angleY: a.angleY, radius: a.radius };
    const frac = (t - a.time) / (b.time - a.time);
    return {
      angleX: a.angleX + (b.angleX - a.angleX) * frac,
      angleY: a.angleY + (b.angleY - a.angleY) * frac,
      radius: a.radius + (b.radius - a.radius) * frac,
    };
  }

  exportJSON(): string {
    const obj: Record<string, unknown> = {
      duration: this.duration,
      tracks: {} as Record<string, unknown>,
      cameraTrack: this.cameraTrack,
    };
    for (const [param, track] of this.tracks) {
      if (track.keyframes.length > 0) {
        (obj['tracks'] as Record<string, unknown>)[param] = {
          keyframes: track.keyframes,
          loop: track.loop,
          speed: track.speed,
          offset: track.offset,
          duration: track.duration,
        };
      }
    }
    return JSON.stringify(obj, null, 2);
  }

  getLastKeyframeCurve(param: string): string | null {
    const track = this.tracks.get(param);
    if (!track || track.keyframes.length === 0) return null;
    return track.keyframes[track.keyframes.length - 1]?.curve ?? null;
  }

  setLastKeyframeCurve(param: string, curve: CurveType): void {
    const track = this.tracks.get(param);
    if (!track || track.keyframes.length === 0) return;
    const last = track.keyframes[track.keyframes.length - 1];
    if (last) last.curve = curve;
  }

  importJSON(json: string): void {
    const obj = JSON.parse(json) as {
      duration?: number;
      cameraTrack?: CameraTrack;
      tracks?: Record<string, Partial<Track>>;
    };
    this.duration = obj.duration ?? 60;
    if (obj.cameraTrack) this.cameraTrack = obj.cameraTrack;
    for (const [param, data] of Object.entries(obj.tracks ?? {})) {
      const track = this.tracks.get(param);
      if (track && data) {
        track.keyframes = (data.keyframes as Keyframe[] | undefined) ?? [];
        track.loop = data.loop ?? 'off';
        track.speed = data.speed ?? 1.0;
        track.offset = data.offset ?? 0;
        track.duration = data.duration ?? this.duration;
      }
    }
  }
}
