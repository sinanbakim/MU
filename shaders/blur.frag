precision mediump float;

uniform sampler2D tMap;
uniform vec2 uDirection;

varying vec2 vUv;

void main() {
    vec4 color = vec4(0.0);

    vec2 off1 = 1.3846153846 * uDirection;
    vec2 off2 = 3.2307692308 * uDirection;

    color += texture2D(tMap, vUv) * 0.2270270270;
    color += texture2D(tMap, vUv + off1) * 0.3162162162;
    color += texture2D(tMap, vUv - off1) * 0.3162162162;
    color += texture2D(tMap, vUv + off2) * 0.0702702703;
    color += texture2D(tMap, vUv - off2) * 0.0702702703;

    gl_FragColor = color;
}
