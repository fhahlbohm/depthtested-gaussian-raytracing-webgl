const {vec3, vec4, mat4} = glMatrix;

const PLY_PATH = './htgs_garden.ply'  // see readme for other scenes
const WORLD_UP = 1; // either 1 or -1 depending on the used ply file
const CONVERT_TO_SURFELS = false;  // when true the smallest axis of each Gaussian will be set to 0
const UPDATE_CAMERA_WH = true;  // forces the width and height from the camera object below (useful on high resolution displays)

const camera = {
    "width": 1280,
    "height": 720,
    "focal_x": 1280.0,
    "focal_y": 1280.0,
    "principal_point_offset_x": 0.0, // positive value -> right
    "principal_point_offset_y": 0.0, // positive value -> up
    "near_plane": 0.2,
    "far_plane": 1000.0
}

const focus_point = vec3.fromValues(0.0, 0.0, -1.25);
const globalUp = vec3.fromValues(0, 0, WORLD_UP);
let initial_w2c = mat4.lookAt(mat4.create(), vec3.fromValues(6.0, 0.0, 0.5), focus_point, globalUp);
const controls = new GLOrbitControls(initial_w2c, focus_point, globalUp);

let M = mat4.create();
let P = mat4.create();
let PM = mat4.create();

async function main() {
    const canvas = document.getElementById("canvas");
    const gl = canvas.getContext("webgl2", {antialias: false, depth: true});

    const vertexShaderSource = await fetchFile('./shaders/render.vert');
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(vertexShader));
        return;
    }

    const fragmentShaderSource = await fetchFile('./shaders/render.frag');
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(fragmentShader));
        return;
    }

    const renderProgram = gl.createProgram();
    gl.attachShader(renderProgram, vertexShader);
    gl.attachShader(renderProgram, fragmentShader);
    gl.linkProgram(renderProgram);
    gl.useProgram(renderProgram);

    if (!gl.getProgramParameter(renderProgram, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(renderProgram));
        return;
    }

    const u_halfWH = gl.getUniformLocation(renderProgram, "halfWH");
    const u_PM = gl.getUniformLocation(renderProgram, "PM");
    const u_M3 = gl.getUniformLocation(renderProgram, "M3");
    const u_near = gl.getUniformLocation(renderProgram, "near");
    const u_far = gl.getUniformLocation(renderProgram, "far");

    // positions
    const triangleVertices = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, triangleVertices, gl.STATIC_DRAW);

    const a_position = gl.getAttribLocation(renderProgram, "position");
    gl.enableVertexAttribArray(a_position);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);

    // splats
    console.time("read ply")
    const loading = document.getElementById("loading");
    const plyFile = await fetchFile(PLY_PATH, 'none');
    const plyByteCount = parseInt(plyFile.headers.get("content-length"))
    const plyData = new Uint8Array(plyByteCount);
    const reader = plyFile.body.getReader();
    let progress = 0;
    let bytesRead = 0;
    while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        plyData.set(value, bytesRead);
        bytesRead += value.length;
        progress = Math.round(100 * bytesRead / plyByteCount);
        // console.log(progress, "% ply loaded")
        loading.innerText = progress + "% ply loaded";
    }
    console.timeEnd("read ply")
    const [splatData, textureWidth, textureHeight, numSplats] = loadSplats(plyData.buffer, CONVERT_TO_SURFELS);

    const splatTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, splatTexture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        textureWidth,
        textureHeight,
        0,
        gl.RGBA,
        gl.FLOAT,
        splatData
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u_splatData = gl.getUniformLocation(renderProgram, "u_splatData");

    const resize = () => {
        if (UPDATE_CAMERA_WH) {
            camera.width = innerWidth;
            camera.height = innerHeight;
        }
        gl.canvas.width = camera.width;
        gl.canvas.height = camera.height;
        gl.viewport(0, 0, camera.width, camera.height);
        P = getProjectionMatrix(camera);
    };

    window.addEventListener("resize", resize);
    resize();

    controls.initialize(canvas);

    let lastFrame = 0;
    let avgFps = 0;
    const fps = document.getElementById("fps");

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clearDepth(camera.far_plane);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    gl.uniform1i(u_splatData, 0);
    gl.uniform1f(u_near, camera.near_plane);
    gl.uniform1f(u_far, camera.far_plane);

    const frame = (now) => {
        const currentFps = (now - lastFrame) || 0;
        avgFps = avgFps * 0.9 + currentFps * 0.1;

        if (controls.wasChanged()) {
            M = controls.getViewMatrix();
            invertCol(M, 2); // flip z axis
            mat4.multiply(PM, P, M);

            gl.uniform2f(u_halfWH, camera.width / 2, camera.height / 2);
            gl.uniform4f(u_M3, M[2], M[6], M[10], M[14]);
            gl.uniformMatrix4fv(u_PM, true, PM);

            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, numSplats);
        }

        requestAnimationFrame(frame);

        fps.innerText = avgFps.toFixed(2) + " ms";
        lastFrame = now;
    };

    frame();

}

main().catch((err) => {
    console.log(err.toString());
});
