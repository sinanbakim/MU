// =========================================================================
// Marker, Section & Cue Point System
// Structured navigation for audio-driven music video playback

export class MarkerSystem {
	constructor() {
		this.markers = [];
		this.sections = [];
		this.cues = [];

		// Section looping
		this.loopSection = null; // index or null

		// Cue tracking
		this._lastCueTime = 0;
	}

	// --- Markers ---

	addMarker(time, label = 'Marker') {
		this.markers.push({ time, label });
		this.markers.sort((a, b) => a.time - b.time);
		return this.markers.length - 1;
	}

	removeMarker(index) {
		this.markers.splice(index, 1);
	}

	getMarkerAt(time, tolerance = 0.5) {
		return this.markers.findIndex((m) => Math.abs(m.time - time) < tolerance);
	}

	// --- Sections ---

	addSection(start, end, label = 'Section') {
		this.sections.push({ start, end, label });
		this.sections.sort((a, b) => a.start - b.start);
	}

	removeSection(index) {
		if (this.loopSection === index) this.loopSection = null;
		else if (this.loopSection !== null && this.loopSection > index) this.loopSection--;
		this.sections.splice(index, 1);
	}

	getCurrentSection(time) {
		for (let i = 0; i < this.sections.length; i++) {
			if (time >= this.sections[i].start && time < this.sections[i].end) return i;
		}
		return -1;
	}

	// --- Section Navigation ---

	jumpToSection(index) {
		if (index >= 0 && index < this.sections.length) {
			return this.sections[index].start;
		}
		return null;
	}

	nextSection(currentTime) {
		for (let i = 0; i < this.sections.length; i++) {
			if (this.sections[i].start > currentTime + 0.1) return this.sections[i].start;
		}
		return null;
	}

	prevSection(currentTime) {
		for (let i = this.sections.length - 1; i >= 0; i--) {
			if (this.sections[i].start < currentTime - 0.5) return this.sections[i].start;
		}
		return null;
	}

	// --- Section Looping ---

	setLoopSection(index) {
		this.loopSection = index !== null && index >= 0 && index < this.sections.length ? index : null;
	}

	checkSectionLoop(currentTime) {
		if (this.loopSection === null) return null;
		const section = this.sections[this.loopSection];
		if (!section) {
			this.loopSection = null;
			return null;
		}
		if (currentTime >= section.end) return section.start;
		return null;
	}

	// --- Cue Points ---

	addCue(time, action, label = 'Cue') {
		this.cues.push({ time, action, label });
		this.cues.sort((a, b) => a.time - b.time);
	}

	removeCue(index) {
		this.cues.splice(index, 1);
	}

	resetCueTracking(time = 0) {
		this._lastCueTime = time;
	}

	// Fire cues that fall between lastTime and currentTime
	fireCues(currentTime) {
		const last = this._lastCueTime;
		for (const cue of this.cues) {
			if (cue.time > last && cue.time <= currentTime && cue.action) {
				try {
					cue.action();
				} catch (e) {
					console.warn('Cue error:', e);
				}
			}
		}
		this._lastCueTime = currentTime;
	}

	// --- Sections from Markers (auto-generate) ---

	generateSectionsFromMarkers(duration) {
		if (this.markers.length === 0) return;
		this.sections = [];
		for (let i = 0; i < this.markers.length; i++) {
			const start = this.markers[i].time;
			const end = i + 1 < this.markers.length ? this.markers[i + 1].time : duration;
			this.sections.push({ start, end, label: this.markers[i].label });
		}
	}

	// --- JSON Export/Import ---

	exportJSON() {
		return {
			markers: this.markers.map((m) => ({ time: m.time, label: m.label })),
			sections: this.sections.map((s) => ({ start: s.start, end: s.end, label: s.label })),
			// Cues with actions can't be serialized — only export times+labels
			cues: this.cues.map((c) => ({ time: c.time, label: c.label })),
		};
	}

	importJSON(data) {
		if (data.markers) {
			this.markers = data.markers.map((m) => ({ time: m.time, label: m.label || 'Marker' }));
			this.markers.sort((a, b) => a.time - b.time);
		}
		if (data.sections) {
			this.sections = data.sections.map((s) => ({ start: s.start, end: s.end, label: s.label || 'Section' }));
			this.sections.sort((a, b) => a.start - b.start);
		}
		if (data.cues) {
			// Import cue positions (actions must be re-bound)
			for (const c of data.cues) {
				this.cues.push({ time: c.time, label: c.label || 'Cue', action: null });
			}
			this.cues.sort((a, b) => a.time - b.time);
		}
		this.loopSection = null;
	}
}

// =========================================================================
