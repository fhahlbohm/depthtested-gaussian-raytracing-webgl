#version 300 es
precision highp float;

// corresponds to 2 sigma
#define MIN_ALPHA_THRESHOLD_RCP 7.38905609893f // 1 / exp(-4/2)
#define MAX_CUTOFF2 4.0f // log(MIN_ALPHA_THRESHOLD_RCP * MIN_ALPHA_THRESHOLD_RCP)
#define MIN_ALPHA_THRESHOLD (1.0f / MIN_ALPHA_THRESHOLD_RCP)

uniform highp sampler2D u_splatData;
uniform mat4 PM;
uniform vec4 M3;
uniform vec2 halfWH;
uniform float near, far;

in vec4 VPMT1, VPMT2, VPMT4, MT3, rgba;

out vec4 fragColor;

void main () {
    vec4 plane_x_diag, plane_y_diag;
    plane_x_diag = VPMT1 - VPMT4 * gl_FragCoord.x;
    plane_y_diag = VPMT2 - VPMT4 * gl_FragCoord.y;
    vec3 m = plane_x_diag.w * plane_y_diag.xyz - plane_x_diag.xyz * plane_y_diag.w;
    vec3 d = cross(plane_x_diag.xyz, plane_y_diag.xyz);
    float numerator = dot(m, m);
    float denominator = dot(d, d);
    if (numerator > MAX_CUTOFF2 * denominator) discard;

    vec3 eval_point_diag = cross(d, m) / denominator;
    float depth = dot(MT3.xyz, eval_point_diag) + MT3.w;
    float normalized_depth = (depth - near) / (far - near);

    float alpha = min(rgba.a * exp(-0.5f * numerator / denominator), 1.0f);
    if (alpha < MIN_ALPHA_THRESHOLD) discard;

    fragColor = vec4(rgba.rgb, alpha);
    gl_FragDepth = normalized_depth;
}