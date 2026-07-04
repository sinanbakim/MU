// =========================================================================
// Parameter Automation Engine
// Keyframe interpolation, camera flights, audio-driven modulation, JSON export/import

export class AutomationEngine {
	constructor() {
		this.tracks = new Map();
		this.modes = new Map();
		this.audioBindings = new Map();
		this.duration = 60;
		this.startTime = 0;
		this.playing = false;

		// Camera flight
		this.cameraTrack = null;
		this.cameraRecording = false;
		this.cameraRecordStart = 0;

		// Smoothed audio values
		this._smoothedAudio = new Map();
	}

	// --- Track Management ---

	addTrack(param) {
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

	addKeyframe(param, time, value, curve = 'linear') {
		const track = this.tracks.get(param);
		if (!track) return;
		track.keyframes.push({ time, value, curve });
		track.keyframes.sort((a, b) => a.time - b.time);
	}

	removeKeyframe(param, index) {
		const track = this.tracks.get(param);
		if (!track) return;
		track.keyframes.splice(index, 1);
	}

	setTrackLoop(param, loopMode) {
		const track = this.tracks.get(param);
		if (track) track.loop = loopMode;
	}

	setTrackSpeed(param, speed) {
		const track = this.tracks.get(param);
		if (track) track.speed = speed;
	}

	setTrackOffset(param, offset) {
		const track = this.tracks.get(param);
		if (track) track.offset = offset;
	}

	setMode(param, mode) {
		this.modes.set(param, mode);
	}

	setAudioBinding(param, binding) {
		this.audioBindings.set(param, {
			source: binding.source || 'amplitude',
			fftBand: binding.fftBand || 0,
			min: binding.min != null ? binding.min : 0,
			max: binding.max != null ? binding.max : 1,
			smoothing: binding.smoothing != null ? binding.smoothing : 0.8,
		});
	}

	// --- Interpolation ---

	_findKeyframePair(keyframes, t) {
		if (keyframes.length === 0) return null;
		if (keyframes.length === 1) return { a: keyframes[0], b: keyframes[0], frac: 0 };

		let lo = 0,
			hi = keyframes.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (keyframes[mid].time <= t) lo = mid;
			else hi = mid - 1;
		}
		const a = keyframes[lo];
		const b = lo + 1 < keyframes.length ? keyframes[lo + 1] : a;
		if (a === b) return { a, b, frac: 0 };
		const frac = (t - a.time) / (b.time - a.time);
		return { a, b, frac: Math.max(0, Math.min(1, frac)) };
	}

	_interpolate(aVal, bVal, frac, curve) {
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

	_resolveTrackTime(track, globalTime) {
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
			case 'off':
			default:
				t = Math.max(0, Math.min(dur, t));
				break;
		}
		return t;
	}

	// --- Audio Helpers ---

	_computeRMS(timeDataL, timeDataR) {
		let sum = 0;
		const len = timeDataL.length;
		for (let i = 0; i < len; i++) {
			sum += timeDataL[i] * timeDataL[i] + timeDataR[i] * timeDataR[i];
		}
		return Math.sqrt(sum / (len * 2));
	}

	_readFFTBand(fftL, fftR, band) {
		const idx = Math.min(band, fftL.length - 1);
		const avgDb = (fftL[idx] + fftR[idx]) / 2;
		return Math.max(0, Math.min(1, (avgDb + 100) / 100));
	}

	// --- Per-Frame Evaluation ---

	evaluate(audioContextTime, audioData) {
		const elapsed = audioContextTime - this.startTime;
		const result = {};

		for (const [param, mode] of this.modes) {
			switch (mode) {
				case 'automation': {
					const track = this.tracks.get(param);
					if (!track || track.keyframes.length === 0) break;
					const t = this._resolveTrackTime(track, elapsed);
					const pair = this._findKeyframePair(track.keyframes, t);
					if (pair) {
						result[param] = this._interpolate(pair.a.value, pair.b.value, pair.frac, pair.a.curve);
					}
					break;
				}
				case 'audio': {
					const binding = this.audioBindings.get(param);
					if (!binding || !audioData) break;
					let raw;
					if (binding.source === 'amplitude') {
						raw = this._computeRMS(audioData.timeDataL, audioData.timeDataR);
					} else {
						raw = this._readFFTBand(audioData.fftDataL, audioData.fftDataR, binding.fftBand);
					}
					const prev = this._smoothedAudio.get(param) || 0;
					const smoothed = prev + (raw - prev) * (1 - binding.smoothing);
					this._smoothedAudio.set(param, smoothed);
					result[param] = binding.min + smoothed * (binding.max - binding.min);
					break;
				}
				case 'manual':
				default:
					break;
			}
		}
		return result;
	}

	// --- Camera Flight ---

	startCameraRecord(audioContextTime) {
		this.cameraTrack = { keyframes: [] };
		this.cameraRecording = true;
		this.cameraRecordStart = audioContextTime;
	}

	recordCameraFrame(audioContextTime, orbitAngleX, orbitAngleY, orbitRadius) {
		if (!this.cameraRecording || !this.cameraTrack) return;
		this.cameraTrack.keyframes.push({
			time: audioContextTime - this.cameraRecordStart,
			angleX: orbitAngleX,
			angleY: orbitAngleY,
			radius: orbitRadius,
		});
	}

	stopCameraRecord() {
		this.cameraRecording = false;
	}

	evaluateCamera(audioContextTime) {
		if (!this.cameraTrack || this.cameraTrack.keyframes.length === 0) return null;
		const t = audioContextTime - this.startTime;
		const kfs = this.cameraTrack.keyframes;

		let lo = 0,
			hi = kfs.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (kfs[mid].time <= t) lo = mid;
			else hi = mid - 1;
		}
		const a = kfs[lo];
		const b = lo + 1 < kfs.length ? kfs[lo + 1] : a;
		if (a === b) return { angleX: a.angleX, angleY: a.angleY, radius: a.radius };
		const frac = (t - a.time) / (b.time - a.time);
		return {
			angleX: a.angleX + (b.angleX - a.angleX) * frac,
			angleY: a.angleY + (b.angleY - a.angleY) * frac,
			radius: a.radius + (b.radius - a.radius) * frac,
		};
	}

	// --- JSON Export/Import ---

	exportJSON() {
		const obj = {
			duration: this.duration,
			tracks: {},
			cameraTrack: this.cameraTrack,
		};
		for (const [param, track] of this.tracks) {
			if (track.keyframes.length > 0) {
				obj.tracks[param] = {
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

	importJSON(json) {
		const obj = JSON.parse(json);
		this.duration = obj.duration || 60;
		if (obj.cameraTrack) this.cameraTrack = obj.cameraTrack;
		for (const [param, data] of Object.entries(obj.tracks)) {
			if (this.tracks.has(param)) {
				const track = this.tracks.get(param);
				track.keyframes = data.keyframes || [];
				track.loop = data.loop || 'off';
				track.speed = data.speed || 1.0;
				track.offset = data.offset || 0;
				track.duration = data.duration || this.duration;
			}
		}
	}
}

// =========================================================================
