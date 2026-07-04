// Marker, Section & Cue Point System
// Structured navigation for audio-driven playback

type Marker = { time: number; label: string };
type Section = { start: number; end: number; label: string };
type Cue = { time: number; action: (() => void) | null; label: string };

export type MarkerData = { time: number; label: string };
export type SectionData = { start: number; end: number; label: string };
export type CueData = { time: number; label: string };

export type MarkerSystemJSON = {
  markers: MarkerData[];
  sections: SectionData[];
  cues: CueData[];
};

export class MarkerSystem {
  markers: Marker[] = [];
  sections: Section[] = [];
  cues: Cue[] = [];
  loopSection: number | null = null;
  private _lastCueTime: number = 0;

  addMarker(time: number, label = 'Marker'): number {
    this.markers.push({ time, label });
    this.markers.sort((a, b) => a.time - b.time);
    return this.markers.length - 1;
  }

  removeMarker(index: number): void {
    this.markers.splice(index, 1);
  }

  getMarkerAt(time: number, tolerance = 0.5): number {
    return this.markers.findIndex((m) => Math.abs(m.time - time) < tolerance);
  }

  addSection(start: number, end: number, label = 'Section'): void {
    this.sections.push({ start, end, label });
    this.sections.sort((a, b) => a.start - b.start);
  }

  removeSection(index: number): void {
    if (this.loopSection === index) this.loopSection = null;
    else if (this.loopSection !== null && this.loopSection > index)
      this.loopSection--;
    this.sections.splice(index, 1);
  }

  getCurrentSection(time: number): number {
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i];
      if (s && time >= s.start && time < s.end) return i;
    }
    return -1;
  }

  jumpToSection(index: number): number | null {
    const s = this.sections[index];
    return s ? s.start : null;
  }

  nextSection(currentTime: number): number | null {
    for (const s of this.sections) {
      if (s.start > currentTime + 0.1) return s.start;
    }
    return null;
  }

  prevSection(currentTime: number): number | null {
    for (let i = this.sections.length - 1; i >= 0; i--) {
      const s = this.sections[i];
      if (s && s.start < currentTime - 0.5) return s.start;
    }
    return null;
  }

  setLoopSection(index: number | null): void {
    this.loopSection =
      index !== null && index >= 0 && index < this.sections.length
        ? index
        : null;
  }

  checkSectionLoop(currentTime: number): number | null {
    if (this.loopSection === null) return null;
    const section = this.sections[this.loopSection];
    if (!section) {
      this.loopSection = null;
      return null;
    }
    return currentTime >= section.end ? section.start : null;
  }

  addCue(time: number, action: (() => void) | null, label = 'Cue'): void {
    this.cues.push({ time, action, label });
    this.cues.sort((a, b) => a.time - b.time);
  }

  removeCue(index: number): void {
    this.cues.splice(index, 1);
  }

  resetCueTracking(time = 0): void {
    this._lastCueTime = time;
  }

  fireCues(currentTime: number): void {
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

  generateSectionsFromMarkers(duration: number): void {
    if (this.markers.length === 0) return;
    this.sections = [];
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      if (!m) continue;
      const start = m.time;
      const end =
        i + 1 < this.markers.length
          ? (this.markers[i + 1]?.time ?? duration)
          : duration;
      this.sections.push({ start, end, label: m.label });
    }
  }

  exportJSON(): MarkerSystemJSON {
    return {
      markers: this.markers.map((m) => ({ time: m.time, label: m.label })),
      sections: this.sections.map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label,
      })),
      cues: this.cues.map((c) => ({ time: c.time, label: c.label })),
    };
  }

  importJSON(data: Partial<MarkerSystemJSON>): void {
    if (data.markers) {
      this.markers = data.markers.map((m) => ({
        time: m.time,
        label: m.label || 'Marker',
      }));
      this.markers.sort((a, b) => a.time - b.time);
    }
    if (data.sections) {
      this.sections = data.sections.map((s) => ({
        start: s.start,
        end: s.end,
        label: s.label || 'Section',
      }));
      this.sections.sort((a, b) => a.start - b.start);
    }
    if (data.cues) {
      for (const c of data.cues) {
        this.cues.push({ time: c.time, label: c.label || 'Cue', action: null });
      }
      this.cues.sort((a, b) => a.time - b.time);
    }
    this.loopSection = null;
  }
}
