precision mediump float;

uniform sampler2D tScene;
uniform sampler2D tBlur;
uniform float uGlow;

varying vec2 vUv;

void main() {
    vec4 base = texture2D(tScene, vUv);
    vec4 glow = texture2D(tBlur, vUv);

    gl_FragColor = base + glow * uGlow;
}
