precision mediump float;

varying vec3 vColor;
varying float vDepth;

uniform float uTrailDepth;

void main() {
    if (vDepth < -uTrailDepth) discard;

    // Tiefe -> Helligkeit: nahe Punkte (z~0) hell, entfernte dunkler
    float depthFade = 1.0 - clamp(-vDepth / uTrailDepth, 0.0, 0.9);
    gl_FragColor = vec4(vColor * depthFade, 1.0);
}
