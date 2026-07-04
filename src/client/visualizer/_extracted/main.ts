// =========================================================================
import studio from "@theatre/studio";
import { getProject } from "@theatre/core";

// 1. Das visuelle Editor-Studio starten
studio.initialize();

// 2. Ein eindeutiges Animations-Projekt für deinen Visualizer erstellen
const project = getProject("Audio Visualizer Project");
const mainSheet = project.sheet("Main Timeline");

// Wir exportieren das Sheet, damit die AudioVisualizer-Klasse darauf zugreifen kann
export { mainSheet };

// Vite Entry Point — Shader ?raw imports + App bootstrap

/* import baseVert from "./shaders/base.vert?raw"; (Datei nicht gefunden!) */
/* import baseFrag from "./shaders/base.frag?raw"; (Datei nicht gefunden!) */
/* import fullscreenVert from "./shaders/fullscreen.vert?raw"; (Datei nicht gefunden!) */
/* import blurFrag from "./shaders/blur.frag?raw"; (Datei nicht gefunden!) */
/* import compositeFrag from "./shaders/composite.frag?raw"; (Datei nicht gefunden!) */
/* import fadeFrag from "./shaders/fade.frag?raw"; (Datei nicht gefunden!) */


// =========================================================================
// STEUERUNG - START MODUL: visualizer.js
// =========================================================================
// Audio Visualizer - Orchestrator
// Verbindet AudioEngine, MidiSynth, RenderPipeline, Automation und UI


import { types } from "@theatre/core";
import studio from "@theatre/studio";

import GUI from "lil-gui";

// =========================================================================
// STEUERUNG - START MODUL: audio.js
// =========================================================================
// Audio Engine: Device Discovery, Mic/File Input, Stereo Analyser Setup
// + AudioWorklet Stream für kontinuierliche Sample-Daten (Ringbuffer)

export class AudioEngine {
  constructor(fftSize = 4096, ringBufferSize = 16384) {
    this.fftSize = fftSize;
    this.bufferLength = fftSize / 2;
    this.debugEnabled = false;

    this.audioContext = null;
    this.analyserL = null;
    this.analyserR = null;
    this.splitter = null;

    // Mic
    this.microphone = null;
    this.stream = null;
    this.permissionStream = null;

    // File
    this.audioElement = null;
    this.audioURL = null;
    this.mediaSource = null;

    // Player state
    this.player = { playing: false, duration: 0, currentTime: 0 };

    // FFT-Buffers (weiterhin AnalyserNode für Frequency-Domain)
    this.fftDataL = new Float32Array(this.bufferLength);
    this.fftDataR = new Float32Array(this.bufferLength);

    // --- Ringbuffer für kontinuierliche Time-Domain Daten (Worklet) ---
    this.ringBufferSize = ringBufferSize;
    this.ringL = new Float32Array(ringBufferSize);
    this.ringR = new Float32Array(ringBufferSize);
    this.ringWriteIndex = 0;
    this.ringReadIndex = 0;
    this.ringSamplesWritten = 0;

    // Neue Samples pro Frame (dynamisch, nicht mehr fixe bufferLength)
    this.newSamplesL = null;
    this.newSamplesR = null;
    this.newSampleCount = 0;

    // Worklet
    this.streamNode = null;

    this.devicesLoaded = false;
  }

  get sampleRate() {
    return this.audioContext ? this.audioContext.sampleRate : 44100;
  }

  // --- Device Discovery ---

  async loadDevices() {
    if (!this.permissionStream) {
      try {
        this.permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (err) {
        console.warn("Mikrofon-Berechtigung verweigert:", err);
        return [];
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === "audioinput");
    this.devicesLoaded = audioInputs.length > 0;
    return audioInputs;
  }

  // --- Stereo Analyser Setup (nur noch für FFT / Frequency-Domain) ---

  _createAnalysers() {
    this.splitter = this.audioContext.createChannelSplitter(2);
    this.analyserL = this.audioContext.createAnalyser();
    this.analyserR = this.audioContext.createAnalyser();
    this.analyserL.fftSize = this.fftSize;
    this.analyserR.fftSize = this.fftSize;
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
  }

  // --- AudioWorklet Stream Setup ---

  async _createStreamNode(source) {
    await this.audioContext.audioWorklet.addModule("stream-processor.js");
    this.streamNode = new AudioWorkletNode(
      this.audioContext,
      "stream-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: "explicit",
      },
    );

    // Ringbuffer-Empfang
    this.streamNode.port.onmessage = (event) => {
      const { left, right } = event.data;
      const len = left.length; // 128 Samples pro Block

      for (let i = 0; i < len; i++) {
        const idx = (this.ringWriteIndex + i) % this.ringBufferSize;
        this.ringL[idx] = left[i];
        this.ringR[idx] = right[i];
      }
      this.ringWriteIndex = (this.ringWriteIndex + len) % this.ringBufferSize;
      this.ringSamplesWritten += len;
    };

    // Signalfluss: source → streamNode → destination (passthrough)
    // Der streamNode leitet Audio durch (outputs = inputs), damit destination noch hörbar ist
    source.connect(this.streamNode);
    this.streamNode.connect(this.audioContext.destination);

    // Zusätzlich: source → splitter → analyser (nur für FFT)
    source.connect(this.splitter);
  }

  // --- Ringbuffer lesen: die letzten N Samples ---

  readRing(count) {
    const n = Math.min(count, this.ringBufferSize);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    const start =
      (this.ringWriteIndex - n + this.ringBufferSize) % this.ringBufferSize;

    for (let i = 0; i < n; i++) {
      const idx = (start + i) % this.ringBufferSize;
      outL[i] = this.ringL[idx];
      outR[i] = this.ringR[idx];
    }
    return { left: outL, right: outR };
  }

  // --- Mic ---

  async startMic(deviceId) {
    this.stop();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.stream = stream;
    this.audioContext = new (
      window.AudioContext || window.webkitAudioContext
    )();
    this._createAnalysers();

    this.microphone = this.audioContext.createMediaStreamSource(stream);

    // Worklet-Stream (Mic → streamNode, kein destination – Mikrofon wird nicht wiedergegeben)
    await this.audioContext.audioWorklet.addModule("stream-processor.js");
    this.streamNode = new AudioWorkletNode(
      this.audioContext,
      "stream-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: "explicit",
      },
    );

    this.streamNode.port.onmessage = (event) => {
      const { left, right } = event.data;
      const len = left.length;
      for (let i = 0; i < len; i++) {
        const idx = (this.ringWriteIndex + i) % this.ringBufferSize;
        this.ringL[idx] = left[i];
        this.ringR[idx] = right[i];
      }
      this.ringWriteIndex = (this.ringWriteIndex + len) % this.ringBufferSize;
      this.ringSamplesWritten += len;
    };

    // Mic: source → streamNode (kein destination, kein Feedback)
    this.microphone.connect(this.streamNode);
    // Für FFT weiterhin über splitter
    this.microphone.connect(this.splitter);
  }

  // --- File ---

  async startFile(file) {
    this.stop();

    this.audioURL = URL.createObjectURL(file);
    this.audioElement = new Audio(this.audioURL);
    this.audioElement.loop = true;

    this.audioContext = new (
      window.AudioContext || window.webkitAudioContext
    )();
    this._createAnalysers();

    this.mediaSource = this.audioContext.createMediaElementSource(
      this.audioElement,
    );

    // Worklet-Stream setup (source → streamNode → destination für Wiedergabe)
    await this._createStreamNode(this.mediaSource);

    // Wait for metadata (duration) but do NOT auto-play
    await new Promise((resolve) => {
      this.audioElement.onloadedmetadata = () => {
        this.player.duration = this.audioElement.duration;
        resolve();
      };
      // Trigger load
      this.audioElement.load();
    });

    this.player.playing = false;
    this.player.currentTime = 0;
  }

  // --- Player Transport ---

  play() {
    if (!this.audioElement) return;
    this.audioElement.play();
    this.player.playing = true;
  }

  pause() {
    if (!this.audioElement) return;
    this.audioElement.pause();
    this.player.playing = false;
  }

  togglePlayback() {
    if (this.player.playing) this.pause();
    else this.play();
  }

  seek(time) {
    if (!this.audioElement) return;
    this.audioElement.currentTime = Math.max(
      0,
      Math.min(time, this.player.duration || Infinity),
    );
    this.player.currentTime = this.audioElement.currentTime;
  }

  syncPlayerTime() {
    if (this.audioElement) {
      this.player.currentTime = this.audioElement.currentTime;
    }
  }

  // --- MIDI (external merger connects to splitter) ---

  async startMidiContext() {
    this.stop();
    this.audioContext = new (
      window.AudioContext || window.webkitAudioContext
    )();
    this._createAnalysers();

    // Worklet für MIDI: wird nach masterGain-Verbindung genutzt
    await this.audioContext.audioWorklet.addModule("stream-processor.js");
    this.streamNode = new AudioWorkletNode(
      this.audioContext,
      "stream-processor",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: "explicit",
      },
    );

    this.streamNode.port.onmessage = (event) => {
      const { left, right } = event.data;
      const len = left.length;
      for (let i = 0; i < len; i++) {
        const idx = (this.ringWriteIndex + i) % this.ringBufferSize;
        this.ringL[idx] = left[i];
        this.ringR[idx] = right[i];
      }
      this.ringWriteIndex = (this.ringWriteIndex + len) % this.ringBufferSize;
      this.ringSamplesWritten += len;
    };

    return {
      audioContext: this.audioContext,
      splitter: this.splitter,
      streamNode: this.streamNode,
    };
  }

  // --- Frame Data ---

  readFrame() {
    if (!this.analyserL || !this.analyserR) return;

    // FFT weiterhin über AnalyserNode (Frequency-Domain)
    this.analyserL.getFloatFrequencyData(this.fftDataL);
    this.analyserR.getFloatFrequencyData(this.fftDataR);

    // Time-Domain: nur NEUE Samples seit letztem readFrame()
    const writePos = this.ringWriteIndex;
    const readPos = this.ringReadIndex;
    let available =
      (writePos - readPos + this.ringBufferSize) % this.ringBufferSize;

    // Schutz: wenn Writer den Reader überrundet hat, maximal ringBufferSize
    if (available > this.ringBufferSize) available = this.ringBufferSize;

    this.newSampleCount = available;

    if (available > 0) {
      this.newSamplesL = new Float32Array(available);
      this.newSamplesR = new Float32Array(available);

      for (let i = 0; i < available; i++) {
        const idx = (readPos + i) % this.ringBufferSize;
        this.newSamplesL[i] = this.ringL[idx];
        this.newSamplesR[i] = this.ringR[idx];
      }

      this.ringReadIndex = writePos;
    } else {
      this.newSamplesL = null;
      this.newSamplesR = null;
    }

    // === DEBUG ===
    if (!this._debugCounter) this._debugCounter = 0;
    this._debugCounter++;

    if (this.debugEnabled && this._debugCounter % 60 === 0) {
      console.log(
        "New samples:",
        this.newSampleCount,
        "| Ring W:",
        writePos,
        "R:",
        readPos,
      );
    }
  }

  // --- Cleanup ---

  stop() {
    if (this.streamNode) {
      try {
        this.streamNode.disconnect();
        this.streamNode.port.close();
      } catch (e) {}
      this.streamNode = null;
    }

    if (this.microphone) {
      try {
        this.microphone.disconnect();
      } catch (e) {}
      this.microphone = null;
    }

    if (this.stream && this.stream.getTracks) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }

    if (this.audioElement) {
      try {
        this.audioElement.pause();
      } catch (e) {}
      if (this.audioURL) {
        URL.revokeObjectURL(this.audioURL);
        this.audioURL = null;
      }
      try {
        if (this.audioElement.srcObject) this.audioElement.srcObject = null;
      } catch (e) {}
      this.audioElement = null;
      this.mediaSource = null;
    }

    this.player.playing = false;
    this.player.duration = 0;
    this.player.currentTime = 0;

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {}
      this.audioContext = null;
    }

    this.analyserL = null;
    this.analyserR = null;
    this.splitter = null;

    // Ringbuffer reset
    this.ringL.fill(0);
    this.ringR.fill(0);
    this.ringWriteIndex = 0;
    this.ringReadIndex = 0;
    this.ringSamplesWritten = 0;
    this.newSamplesL = null;
    this.newSamplesR = null;
    this.newSampleCount = 0;
  }
}

// =========================================================================
