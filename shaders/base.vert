attribute vec3 position;
attribute vec3 color;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uPointSize;

varying vec3 vColor;
varying float vDepth;

void main() {
    vDepth = position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
    vColor = color;
}
