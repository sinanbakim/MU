precision mediump float;

uniform sampler2D tMap;
uniform float uFade;

varying vec2 vUv;

void main() {
    vec4 color = texture2D(tMap, vUv);
    gl_FragColor = color * (1.0 - uFade);
}
