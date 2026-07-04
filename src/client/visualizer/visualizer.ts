// AudioVisualizer — Orchestrator
// Connects AudioEngine, MidiSynth, RenderPipeline, AutomationEngine, MarkerSystem and GUI

import GUI from 'lil-gui';
import { AudioEngine } from './audio';
import { MidiSynth } from './midi';
import { RenderPipeline } from './renderer';
import type { ShaderSources } from './renderer';
import { AutomationEngine } from './automation';
import { MarkerSystem } from './markers';
import { ContextMenu } from './context-menu';
import { detectPitch, calculateColor } from './analysis';

const AUTOMATABLE = [
  'pointSize',
  'amplitudeScale',
  'glowIntensity',
  'saturationBoost',
  'fadeOut',
  'delayL',
  'delayR',
  'rotation',
  'trailDepth',
  'zSpeed',
] as const;

type AutomatableParam = (typeof AUTOMATABLE)[number];

const RENDER_MODES = [
  'POINTS',
  'LINES',
  'LINE_STRIP',
  'LINE_LOOP',
  'TRIANGLES',
  'TRIANGLE_STRIP',
  'TRIANGLE_FAN',
] as const;

const Z_MODES = ['flow', 'accumulate'] as const;

type Settings = {
  renderMode: string;
  pointSize: number;
  amplitudeScale: number;
  glowIntensity: number;
  saturationBoost: number;
  fadeOut: number;
  delayL: number;
  delayR: number;
  rotation: number;
  zMode: string;
  trailDepth: number;
  zSpeed: number;
  debugEnabled: boolean;
  useOrthoProjection: boolean;
};

export class AudioVisualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly audio: AudioEngine;

  get audioContext(): AudioContext | null {
    return this.audio.audioContext;
  }
  private readonly midi: MidiSynth;
  readonly render: RenderPipeline;
  private readonly automation: AutomationEngine;
  private readonly markerSystem: MarkerSystem;
  private contextMenu: ContextMenu | null = null;

  settings: Settings = {
    renderMode: 'POINTS',
    pointSize: 1.5,
    amplitudeScale: 4.0,
    glowIntensity: 0.2,
    saturationBoost: 1.0,
    fadeOut: 1.0,
    delayL: 0,
    delayR: 0,
    rotation: 0.785398,
    zMode: 'flow',
    trailDepth: 0.5,
    zSpeed: 0.000001,
    debugEnabled: false,
    useOrthoProjection: false,
  };

  private gui: GUI | null = null;
  private globalSampleIndex: number = 0;
  private _lastZMode: string = 'flow';
  private mode: 'mic' | 'file' | 'midi' = 'mic';
  private animationId: number | null = null;
  private mouseDown: boolean = false;
  private uiHidden: boolean = false;

  private timelineEl: HTMLDivElement | null = null;
  private timelineProgress: HTMLDivElement | null = null;
  private _markerLayer: HTMLDivElement | null = null;
  private _sectionLayer: HTMLDivElement | null = null;
  private _playhead: HTMLDivElement | null = null;
  private _sectionLabel: HTMLDivElement | null = null;
  private _timelineDragging: boolean = false;
  private _sectionEls: HTMLDivElement[] = [];

  constructor(shaders: ShaderSources) {
    const canvasEl = document.getElementById('glCanvas');
    if (!(canvasEl instanceof HTMLCanvasElement))
      throw new Error('Canvas #glCanvas not found');
    this.canvas = canvasEl;

    this.audio = new AudioEngine();
    this.midi = new MidiSynth();
    this.render = new RenderPipeline(this.canvas);
    this.automation = new AutomationEngine();
    this.markerSystem = new MarkerSystem();

    for (const p of AUTOMATABLE) {
      this.automation.addTrack(p);
    }

    this.render.init(
      {
        pointSize: this.settings.pointSize,
        trailDepth: this.settings.trailDepth,
        glowIntensity: this.settings.glowIntensity,
        fadeOut: this.settings.fadeOut,
        renderMode: this.settings.renderMode,
      },
      shaders
    );

    this._setupGUI();
    this._createTimelineBar();
    this._populateDevices();
  }

  private async _populateDevices(): Promise<void> {
    // In Reddit's iframe sandbox getUserMedia is blocked — detect early and hide mic UI
    const micAvailable =
      typeof navigator.mediaDevices !== 'undefined' &&
      typeof navigator.mediaDevices.getUserMedia === 'function';

    if (!micAvailable) {
      this._disableMicControls();
      this.updateStatus('Mikrofon nicht verfügbar (Reddit Sandbox) — Datei laden ↑');
      return;
    }

    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await this.audio.loadDevices();
    } catch (_) {
      this._disableMicControls();
      this.updateStatus('Mikrofon nicht verfügbar (Reddit Sandbox) — Datei laden ↑');
      return;
    }

    const select = document.getElementById('audioDevice');
    if (select instanceof HTMLSelectElement) {
      select.innerHTML = '<option value="">Gerät auswählen...</option>';
      devices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Audio-Gerät ${index + 1}`;
        select.appendChild(option);
      });
    }

    if (devices.length === 0) {
      this.updateStatus('Keine Audio-Eingabegeräte gefunden');
      this._disableMicControls();
    } else {
      this.updateStatus(`${devices.length} Audio-Gerät(e) gefunden`);
    }
  }

  private _disableMicControls(): void {
    const sel = document.getElementById('audioDevice');
    const btn = document.getElementById('startBtn');
    // Hide the mic dropdown entirely — it can't work in Reddit's sandbox
    if (sel instanceof HTMLSelectElement) {
      sel.style.display = 'none';
    }
    // Start button is still useful for file mode — only disable if no file selected
    if (btn instanceof HTMLButtonElement) btn.disabled = true;
  }

  private _setupGUI(): void {
    this.gui = new GUI({ title: 'Audio Visualizer' });

    const renderFolder = this.gui.addFolder('Rendering');
    renderFolder
      .add(this.settings, 'renderMode', [...RENDER_MODES])
      .name('Render Mode')
      .onChange((v: string) => {
        if (this.render.mesh && this.render.gl) {
          this.render.mesh.mode =
            (this.render.gl as unknown as Record<string, number>)[v] ??
            this.render.gl.POINTS;
        }
      });
    renderFolder
      .add(this.settings, 'pointSize', 1, 10, 0.5)
      .name('Point/Line Size')
      .onChange((v: number) => {
        if (this.render.programs.base)
          (
            this.render.programs.base.uniforms as Record<
              string,
              { value: number }
            >
          )['uPointSize']!.value = v;
      });
    renderFolder
      .add(this.settings, 'glowIntensity', 0, 1, 0.05)
      .name('Glow')
      .onChange((v: number) => {
        if (this.render.programs.composite)
          (
            this.render.programs.composite.uniforms as Record<
              string,
              { value: number }
            >
          )['uGlow']!.value = v;
      });
    renderFolder
      .add(this.settings, 'fadeOut', 0.01, 1, 0.01)
      .name('Fade-Out')
      .onChange((v: number) => {
        if (this.render.programs.fade)
          (
            this.render.programs.fade.uniforms as Record<
              string,
              { value: number }
            >
          )['uFade']!.value = v;
      });

    const signalFolder = this.gui.addFolder('Signal');
    signalFolder
      .add(this.settings, 'amplitudeScale', 0.1, 20, 0.1)
      .name('Amplitude');
    signalFolder
      .add(this.settings, 'saturationBoost', 1, 3, 0.1)
      .name('Saturation');
    signalFolder.add(this.settings, 'delayL', 0, 512, 1).name('Delay L');
    signalFolder.add(this.settings, 'delayR', 0, 512, 1).name('Delay R');

    const spatialFolder = this.gui.addFolder('3D / Z-Axis');
    spatialFolder
      .add(this.settings, 'rotation', 0, 6.28, 0.01)
      .name('Rotation')
      .onChange((v: number) => {
        if (this.render.mesh) this.render.mesh.rotation.z = v;
      });
    spatialFolder
      .add(this.settings, 'zMode', [...Z_MODES])
      .name('Z Mode')
      .onChange(() => {
        this.render.resetRingbuffer();
        this.globalSampleIndex = 0;
      });
    spatialFolder
      .add(this.settings, 'trailDepth', 0.5, 10, 0.1)
      .name('Trail Depth')
      .onChange((v: number) => {
        if (this.render.programs.base)
          (
            this.render.programs.base.uniforms as Record<
              string,
              { value: number }
            >
          )['uTrailDepth']!.value = v;
      });
    spatialFolder
      .add(this.settings, 'zSpeed', -0.05, 0.05, 0.00001)
      .name('Z Speed');

    const viewFolder = this.gui.addFolder('View / Debug');
    viewFolder
      .add(this.settings, 'debugEnabled')
      .name('Debug Output')
      .onChange((v: boolean) => {
        this.audio.debugEnabled = v;
      });
    viewFolder
      .add(this.settings, 'useOrthoProjection')
      .name('Orthographic View')
      .onChange((v: boolean) => {
        this.render.setProjection(v, this.render.orbitRadius);
      });

    this._setupHWListeners();
    this._setupOrbitControls();
    this._setupKeyboardShortcuts();

    this.contextMenu = new ContextMenu(this.canvas);
    this.contextMenu.onBeforeShow = () => this._buildContextMenuItems();
  }

  private _setupHWListeners(): void {
    document
      .getElementById('startBtn')
      ?.addEventListener('click', () => void this._start());
    document
      .getElementById('stopBtn')
      ?.addEventListener('click', () => this._stop());

    const fileInput = document.getElementById('audioFile');
    if (fileInput instanceof HTMLInputElement) {
      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
          this.mode = 'file';
          // Re-enable start button in case mic was unavailable
          const startBtn = document.getElementById('startBtn');
          if (startBtn instanceof HTMLButtonElement) startBtn.disabled = false;
          void this._start();
        }
      });
    }

    const deviceSelect = document.getElementById('audioDevice');
    if (deviceSelect instanceof HTMLSelectElement) {
      deviceSelect.addEventListener('change', () => {
        if (deviceSelect.value) this.mode = 'mic';
      });
    }

    const midiBtn = document.getElementById('midiBtn');
    if (midiBtn instanceof HTMLButtonElement) {
      midiBtn.addEventListener('click', () => {
        if (this.mode !== 'midi') {
          this.mode = 'midi';
          void this._start().then(() => midiBtn.classList.add('active'));
        } else {
          this.mode = 'mic';
          this._stop();
          midiBtn.classList.remove('active');
        }
      });
    }
  }

  private _setupOrbitControls(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => {
      this.mouseDown = false;
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.mouseDown) return;
      this.render.orbitAngleX -= e.movementX * 0.005;
      this.render.orbitAngleY += e.movementY * 0.005;
      this.render.orbitAngleY = Math.max(
        -Math.PI * 0.45,
        Math.min(Math.PI * 0.45, this.render.orbitAngleY)
      );
      this.render.updateCameraOrbit();
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.render.orbitRadius += e.deltaY * 0.005;
        this.render.orbitRadius = Math.max(
          0.5,
          Math.min(20, this.render.orbitRadius)
        );
        this.render.updateCameraOrbit();
        if (this.settings.useOrthoProjection) {
          this.render.setProjection(true, this.render.orbitRadius);
        }
      },
      { passive: false }
    );
  }

  private _setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          if (this.mode === 'file' && this.audio.audioElement) {
            this.audio.togglePlayback();
          }
          break;
        case 'm':
          if (this.mode === 'file' && this.audio.audioElement) {
            const time = this.audio.player.currentTime;
            const label = prompt(
              'Marker label:',
              'Marker ' + (this.markerSystem.markers.length + 1)
            );
            if (label !== null) {
              this.markerSystem.addMarker(time, label);
              this._rebuildTimelineOverlays();
            }
          }
          break;
        case '[': {
          if (this.mode !== 'file' || !this.audio.audioElement) break;
          const prev = this.markerSystem.prevSection(
            this.audio.player.currentTime
          );
          if (prev !== null) {
            this.audio.seek(prev);
            this.markerSystem.resetCueTracking(prev);
          }
          break;
        }
        case ']': {
          if (this.mode !== 'file' || !this.audio.audioElement) break;
          const next = this.markerSystem.nextSection(
            this.audio.player.currentTime
          );
          if (next !== null) {
            this.audio.seek(next);
            this.markerSystem.resetCueTracking(next);
          }
          break;
        }
        case 'l':
          if (this.mode === 'file' && this.audio.audioElement) {
            const curSec = this.markerSystem.getCurrentSection(
              this.audio.player.currentTime
            );
            if (this.markerSystem.loopSection === curSec) {
              this.markerSystem.setLoopSection(null);
              this.updateStatus('Section loop: off', true);
            } else if (curSec >= 0) {
              this.markerSystem.setLoopSection(curSec);
              this.updateStatus(
                'Looping: ' + (this.markerSystem.sections[curSec]?.label ?? ''),
                true
              );
            }
          }
          break;
        case 'h': {
          this.uiHidden = !this.uiHidden;
          const display = this.uiHidden ? 'none' : '';
          if (this.gui) this.gui.domElement.style.display = display;
          const hwControls = document.getElementById('hw-controls');
          if (hwControls) hwControls.style.display = display;
          const statusEl = document.getElementById('status');
          if (statusEl) statusEl.style.display = display;
          break;
        }
        case 'f':
          if (!document.fullscreenElement) {
            void document.documentElement.requestFullscreen();
          } else {
            void document.exitFullscreen();
          }
          break;
      }
    });
  }

  private _buildContextMenuItems(): void {
    const currentTime = this.audio.audioContext?.currentTime ?? 0;
    const elapsed = currentTime - this.automation.startTime;

    this.contextMenu?.setItems({
      'Add Keyframe...': () => {
        const paramInput = prompt('Parameter:\n' + AUTOMATABLE.join(', '));
        if (
          !paramInput ||
          !(AUTOMATABLE as readonly string[]).includes(paramInput)
        )
          return;
        const param = paramInput as AutomatableParam;
        const value = this.settings[param] as number;
        const curve = (prompt(
          'Curve (linear / smoothstep / step):',
          'linear'
        ) ?? 'linear') as 'linear' | 'smoothstep' | 'step';
        this.automation.addKeyframe(param, elapsed, value, curve);
      },
      'Set Curve Type...': () => {
        const param = prompt('Parameter:\n' + AUTOMATABLE.join(', '));
        if (!param) return;
        const curve = prompt(
          'Curve (linear / smoothstep / step):',
          'linear'
        ) as 'linear' | 'smoothstep' | 'step' | null;
        if (!curve) return;
        this.automation.setLastKeyframeCurve(param, curve);
      },
      '---sep1': null,
      'Loop: Off': () => {
        const p = prompt('Parameter:');
        if (p) this.automation.setTrackLoop(p, 'off');
      },
      'Loop: Loop': () => {
        const p = prompt('Parameter:');
        if (p) this.automation.setTrackLoop(p, 'loop');
      },
      'Loop: Ping-Pong': () => {
        const p = prompt('Parameter:');
        if (p) this.automation.setTrackLoop(p, 'pingpong');
      },
      '---sep2': null,
      'Set Speed...': () => {
        const p = prompt('Parameter:');
        const speed = parseFloat(prompt('Speed multiplier:', '1.0') ?? '1');
        if (p && !isNaN(speed)) this.automation.setTrackSpeed(p, speed);
      },
      'Set Offset...': () => {
        const p = prompt('Parameter:');
        const offset = parseFloat(prompt('Time offset (s):', '0') ?? '0');
        if (p && !isNaN(offset)) this.automation.setTrackOffset(p, offset);
      },
    });
  }

  private _createTimelineBar(): void {
    this.timelineEl = document.createElement('div');
    Object.assign(this.timelineEl.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      width: '100%',
      height: '6px',
      background: 'rgba(255,255,255,0.1)',
      zIndex: '200',
      cursor: 'pointer',
      transition: 'height 0.15s',
      display: 'none',
    });

    this._sectionLayer = document.createElement('div');
    Object.assign(this._sectionLayer.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    this.timelineEl.appendChild(this._sectionLayer);

    this.timelineProgress = document.createElement('div');
    Object.assign(this.timelineProgress.style, {
      width: '0%',
      height: '100%',
      background: '#0af',
      position: 'absolute',
      top: '0',
      left: '0',
      pointerEvents: 'none',
      opacity: '0.6',
    });
    this.timelineEl.appendChild(this.timelineProgress);

    this._markerLayer = document.createElement('div');
    Object.assign(this._markerLayer.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    this.timelineEl.appendChild(this._markerLayer);

    this._playhead = document.createElement('div');
    Object.assign(this._playhead.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '2px',
      height: '100%',
      background: '#fff',
      pointerEvents: 'none',
      zIndex: '1',
    });
    this.timelineEl.appendChild(this._playhead);

    this._sectionLabel = document.createElement('div');
    Object.assign(this._sectionLabel.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '2px 8px',
      background: 'rgba(0,0,0,0.7)',
      color: '#fff',
      fontSize: '11px',
      borderRadius: '3px',
      pointerEvents: 'none',
      zIndex: '201',
      display: 'none',
    });
    document.body.appendChild(this._sectionLabel);
    document.body.appendChild(this.timelineEl);

    this.timelineEl.addEventListener('mouseenter', () => {
      this.timelineEl!.style.height = '12px';
    });
    this.timelineEl.addEventListener('mouseleave', () => {
      if (!this._timelineDragging) this.timelineEl!.style.height = '6px';
    });

    const scrub = (e: MouseEvent) => {
      const rect = this.timelineEl!.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      this.audio.seek(ratio * this.audio.player.duration);
      this.markerSystem.resetCueTracking(this.audio.player.currentTime);
    };

    this.timelineEl.addEventListener('mousedown', (e) => {
      this._timelineDragging = true;
      scrub(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (this._timelineDragging) scrub(e);
    });
    window.addEventListener('mouseup', () => {
      if (this._timelineDragging) {
        this._timelineDragging = false;
        if (this.timelineEl) this.timelineEl.style.height = '6px';
      }
    });
  }

  private _rebuildTimelineOverlays(): void {
    if (!this._sectionLayer || !this._markerLayer) return;
    const dur = this.audio.player.duration;
    if (dur <= 0) return;

    this._sectionLayer.innerHTML = '';
    this._sectionEls = [];
    const sectionColors = [
      '#f44',
      '#fa0',
      '#0c6',
      '#08f',
      '#c4f',
      '#ff0',
      '#0cc',
    ];
    for (let i = 0; i < this.markerSystem.sections.length; i++) {
      const s = this.markerSystem.sections[i];
      if (!s) continue;
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute',
        top: '0',
        left: (s.start / dur) * 100 + '%',
        width: ((s.end - s.start) / dur) * 100 + '%',
        height: '100%',
        background: sectionColors[i % sectionColors.length] ?? '#fff',
        opacity: '0.2',
      });
      this._sectionLayer.appendChild(el);
      this._sectionEls.push(el);
    }

    this._markerLayer.innerHTML = '';
    for (const m of this.markerSystem.markers) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute',
        top: '0',
        left: (m.time / dur) * 100 + '%',
        width: '2px',
        height: '100%',
        background: '#ff0',
        opacity: '0.8',
      });
      el.title = m.label + ' (' + m.time.toFixed(1) + 's)';
      this._markerLayer.appendChild(el);
    }
  }

  private _updateTimeline(): void {
    if (!this.timelineEl || !this._sectionLabel) return;
    if (this.mode !== 'file' || !this.audio.audioElement || this.uiHidden) {
      this.timelineEl.style.display = 'none';
      this._sectionLabel.style.display = 'none';
      return;
    }

    this.timelineEl.style.display = '';
    const dur = this.audio.player.duration;
    const cur = this.audio.player.currentTime;
    if (dur <= 0) return;

    const pct = (cur / dur) * 100;
    if (this.timelineProgress) this.timelineProgress.style.width = pct + '%';
    if (this._playhead) this._playhead.style.left = pct + '%';

    const activeIdx = this.markerSystem.getCurrentSection(cur);
    for (let i = 0; i < this._sectionEls.length; i++) {
      const el = this._sectionEls[i];
      if (el) el.style.opacity = i === activeIdx ? '0.4' : '0.2';
    }

    if (activeIdx >= 0) {
      const s = this.markerSystem.sections[activeIdx];
      if (s) {
        this._sectionLabel.textContent = s.label;
        this._sectionLabel.style.display = '';
      }
    } else {
      this._sectionLabel.style.display = 'none';
    }
  }

  private async _start(): Promise<void> {
    if (
      !this.audio.devicesLoaded &&
      this.mode !== 'file' &&
      this.mode !== 'midi'
    ) {
      await this._populateDevices();
    }

    const fileInput = document.getElementById('audioFile');
    if (fileInput instanceof HTMLInputElement && fileInput.files?.[0]) {
      this.mode = 'file';
      await this.audio.startFile(fileInput.files[0]);
      this.audio.play();
      // Resume AudioContext — browsers (especially in iframes) start it suspended
      if (this.audio.audioContext && this.audio.audioContext.state === 'suspended') {
        await this.audio.audioContext.resume();
      }
      this.markerSystem.resetCueTracking(0);
      this._rebuildTimelineOverlays();
    } else if (this.mode === 'midi') {
      const ctx = await this.audio.startMidiContext();
      this.midi.start(ctx.audioContext, ctx.splitter, ctx.streamNode);
    } else {
      this.mode = 'mic';
      const deviceSelect = document.getElementById('audioDevice');
      const deviceId =
        deviceSelect instanceof HTMLSelectElement ? deviceSelect.value : '';
      if (!deviceId) {
        this.updateStatus('Bitte wähle ein Audio-Gerät aus!');
        return;
      }
      await this.audio.startMic(deviceId);
    }

    // Resume AudioContext after any user-gesture triggered start
    if (this.audio.audioContext && this.audio.audioContext.state === 'suspended') {
      await this.audio.audioContext.resume();
    }

    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const audioDevice = document.getElementById('audioDevice');
    if (startBtn instanceof HTMLButtonElement) startBtn.disabled = true;
    if (stopBtn instanceof HTMLButtonElement) stopBtn.disabled = false;
    if (audioDevice instanceof HTMLSelectElement) audioDevice.disabled = true;

    const labels: Record<string, string> = {
      mic: 'Läuft...',
      file: 'Datei läuft...',
      midi: 'MIDI Synth aktiv (polyphon)',
    };
    this.updateStatus(labels[this.mode] ?? 'Läuft...', true);
    this.render.resetRingbuffer();
    this.globalSampleIndex = 0;
    this._draw();
  }

  private _stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.midi.stop();
    this.audio.stop();

    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const audioDevice = document.getElementById('audioDevice');
    if (startBtn instanceof HTMLButtonElement) startBtn.disabled = false;
    if (stopBtn instanceof HTMLButtonElement) stopBtn.disabled = true;
    if (audioDevice instanceof HTMLSelectElement) audioDevice.disabled = false;

    this.updateStatus('Gestoppt');
    this.render.clear();
  }

  updateStatus(text: string, active = false): void {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = 'Status: ' + text;
      status.classList.toggle('active', active);
    }
  }

  async resumeAudioContext(): Promise<void> {
    await this.audio.resumeContext();
  }

  // --- Keyboard synth fallback (for environments where WebMIDI is blocked) ---
  private keyboardVoices: Map<number, { osc: OscillatorNode; gain: GainNode }> = new Map();
  private _synthGain = 0.12;

  async playKeyNote(midiNote: number): Promise<void> {
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    // Ensure AudioContext exists and is resumed
    if (!this.audio.audioContext) {
      // Initialize the shared AudioContext via AudioEngine helper
      try {
        await this.audio.startMidiContext();
      } catch (e) {
        // Fallback: create a basic AudioContext if startMidiContext fails
        this.audio.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        await this.audio.resumeContext();
      }
    } else if (this.audio.audioContext.state === 'suspended') {
      await this.audio.audioContext.resume();
    }

    const ctx = this.audio.audioContext!;
    // Prevent duplicate note
    if (this.keyboardVoices.has(midiNote)) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = this._synthGain;
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    try {
      osc.start();
    } catch (e) {
      // ignore if already started
    }
    this.keyboardVoices.set(midiNote, { osc, gain });

    // Visual effect: modulate rotation slightly by note
    try {
      if (this.render && this.render.mesh) {
        const base = this.settings.rotation || 0.785398;
        const rot = base + ((midiNote - 60) / 12) * 0.6; // small shift
        this.render.mesh.rotation.z = rot;
      }
    } catch (e) {}
  }

  stopKeyNote(midiNote: number): void {
    const v = this.keyboardVoices.get(midiNote);
    if (!v) return;
    try {
      const ctx = this.audio.audioContext;
      if (ctx) v.gain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.02);
      setTimeout(() => {
        try { v.osc.stop(); } catch (e) {}
        try { v.osc.disconnect(); } catch (e) {}
        try { v.gain.disconnect(); } catch (e) {}
      }, 120);
    } catch (e) {}
    this.keyboardVoices.delete(midiNote);

    // Restore rotation to default
    try {
      if (this.render && this.render.mesh) {
        this.render.mesh.rotation.z = this.settings.rotation || 0.785398;
      }
    } catch (e) {}
  }

  private _draw(): void {
    this.animationId = requestAnimationFrame(() => this._draw());

    this.audio.syncPlayerTime();
    this.audio.readFrame();

    const t =
      this.mode === 'file' && this.audio.audioElement
        ? this.audio.audioElement.currentTime
        : (this.audio.audioContext?.currentTime ?? 0);

    // Camera playback from automation
    if (!this.automation.cameraRecording) {
      const cam = this.automation.evaluateCamera(t);
      if (cam) {
        this.render.orbitAngleX = cam.angleX;
        this.render.orbitAngleY = cam.angleY;
        this.render.orbitRadius = cam.radius;
        this.render.updateCameraOrbit();
      }
    }

    const currentDuration =
      this.audio.player.duration || this.automation.duration || 60;
    const pct = Math.min(100, (t / currentDuration) * 100);
    if (this.timelineProgress) this.timelineProgress.style.width = pct + '%';
    if (!this.uiHidden && this.timelineEl) this.timelineEl.style.display = '';

    this._updateTimeline();

    if (this.mode === 'file' && this.audio.audioElement) {
      const loopTarget = this.markerSystem.checkSectionLoop(
        this.audio.player.currentTime
      );
      if (loopTarget !== null) {
        this.audio.seek(loopTarget);
        this.markerSystem.resetCueTracking(loopTarget);
      }
      this.markerSystem.fireCues(this.audio.player.currentTime);
    }

    if (this.automation.cameraRecording && this.audio.audioContext) {
      this.automation.recordCameraFrame(
        this.audio.audioContext.currentTime,
        this.render.orbitAngleX,
        this.render.orbitAngleY,
        this.render.orbitRadius
      );
    }

    const sampleRate = this.audio.sampleRate;
    const pitchL = detectPitch(this.audio.fftDataL, sampleRate);
    const pitchR = detectPitch(this.audio.fftDataR, sampleRate);
    const avgFreq = (pitchL.frequency + pitchR.frequency) / 2;
    const avgAmp = (pitchL.amplitude + pitchR.amplitude) / 2;
    const color = calculateColor(
      avgFreq,
      avgAmp,
      this.settings.saturationBoost
    );

    const sampleCount = this.audio.newSampleCount;
    const samplesL = this.audio.newSamplesL;
    const samplesR = this.audio.newSamplesR;
    const perSampleZ = this.settings.zSpeed;

    if (this.settings.zMode === 'flow' && sampleCount > 0) {
      this.render.shiftZ(sampleCount * perSampleZ);
    }

    if (sampleCount > 0 && samplesL && samplesR) {
      let localIndex = this.globalSampleIndex;
      for (let i = 0; i < sampleCount; i++) {
        const iL = (i + this.settings.delayL) % sampleCount;
        const iR = (i + this.settings.delayR) % sampleCount;
        const x = (samplesL[iL] ?? 0) * this.settings.amplitudeScale;
        const y = (samplesR[iR] ?? 0) * this.settings.amplitudeScale;
        const z =
          this.settings.zMode === 'flow'
            ? -(sampleCount - 1 - i) * perSampleZ
            : localIndex * perSampleZ;
        this.render.writePoint(x, y, z, color[0], color[1], color[2]);
        localIndex++;
      }
      this.globalSampleIndex = localIndex;
    }

    this.render.commitFrame();

    if (this.render.programs.base) {
      (this.render.programs.base.uniforms as Record<string, { value: number }>)[
        'uTrailDepth'
      ]!.value = this.settings.trailDepth;
    }

    if (this.settings.renderMode.includes('LINE') && this.render.gl) {
      this.render.gl.lineWidth(this.settings.pointSize);
    }

    // Z-mode reset when changed
    if (this._lastZMode !== this.settings.zMode) {
      this.render.resetRingbuffer();
      this.globalSampleIndex = 0;
      this._lastZMode = this.settings.zMode;
    }

    this.render.render(this.settings.glowIntensity);
  }
}
