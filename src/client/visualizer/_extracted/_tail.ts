// =========================================================================


const shaders = {
  baseVert,
  baseFrag,
  fullscreenVert,
  blurFrag,
  compositeFrag,
  fadeFrag,
};

window.addEventListener("DOMContentLoaded", () => {
  window.visualizer = new AudioVisualizer(shaders);
});

// =========================================================================
// STEUERUNG - ENDE MODUL: main.js
// =========================================================================
