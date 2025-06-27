async function fetchFile(path, type = 'text') {
    try {
        const response = await fetch(path)
        if (!response.ok) {
            // noinspection ExceptionCaughtLocallyJS
            throw new Error("Unable to load file, Error " + response.status);
        }
        if (type === "none") return response;
        return response[type]()
    } catch (error) { console.error(error.message); }
}

// helper functions for computing argmin
const argFact = (compareFn) => (array) => array.map((el, idx) => [el, idx]).reduce(compareFn)[1]
const argMin = argFact((max, el) => (el[0] < max[0] ? el : max))

function createT(quaternion, scales, mean) {
    let x = quaternion[0],
        y = quaternion[1],
        z = quaternion[2],
        w = quaternion[3];
    let x2 = x + x;
    let y2 = y + y;
    let z2 = z + z;
    let xx = x * x2;
    let xy = x * y2;
    let xz = x * z2;
    let yy = y * y2;
    let yz = y * z2;
    let zz = z * z2;
    let wx = w * x2;
    let wy = w * y2;
    let wz = w * z2;
    let sx = scales[0];
    let sy = scales[1];
    let sz = scales[2];
    return [
        (1 - (yy + zz)) * sx, (xy - wz) * sy, (xz + wy) * sz, mean[0],
        (xy + wz) * sx, (1 - (xx + zz)) * sy, (yz - wx) * sz, mean[1],
        (xz - wy) * sx, (yz + wx) * sy, (1 - (xx + yy)) * sz, mean[2]
    ];
}

function getProjectionMatrix(camera) {
    const half_width = camera.width * 0.5;
    const half_height = camera.height * 0.5;
    const P = mat4.create();
    P[0] = camera.focal_x / half_width;
    P[5] = camera.focal_y / half_height;
    P[8] = camera.principal_point_offset_x / half_width;
    P[9] = camera.principal_point_offset_y / half_height;
    P[10] = (camera.far_plane + camera.near_plane) / (camera.far_plane - camera.near_plane);
    P[11] = 1.0;
    P[14] = -2.0 * camera.far_plane * camera.near_plane / (camera.far_plane - camera.near_plane);
    P[15] = 0.0;
    return P;
}

function loadSplats(plyBuffer, convertToSurfels) {
    const ubuf = new Uint8Array(plyBuffer);
    const header = new TextDecoder().decode(ubuf.slice(0, 1024 * 10));
    const header_end = "end_header\n";
    const header_end_index = header.indexOf(header_end);
    if (header_end_index < 0)
        throw new Error("Unable to read .ply file header");
    const numSplats = parseInt(/element vertex (\d+)\n/.exec(header)[1]);
    console.log("Splat Count", numSplats);
    let row_offset = 0,
        offsets = {},
        types = {};
    const TYPE_MAP = {
        double: "getFloat64",
        int: "getInt32",
        uint: "getUint32",
        float: "getFloat32",
        short: "getInt16",
        ushort: "getUint16",
        uchar: "getUint8",
    };
    for (let prop of header
        .slice(0, header_end_index)
        .split("\n")
        .filter((k) => k.startsWith("property "))) {
        const [p, type, name] = prop.split(" ");
        const arrayType = TYPE_MAP[type] || "getInt8";
        types[name] = arrayType;
        offsets[name] = row_offset;
        row_offset += parseInt(arrayType.replace(/[^\d]/g, "")) / 8;
    }
    console.log("Bytes per row", row_offset, types, offsets);

    let dataView = new DataView(
        plyBuffer,
        header_end_index + header_end.length,
    );
    let splatIdx = 0;
    const attrs = new Proxy(
        {},
        {
            get(target, prop) {
                if (!types[prop]) throw new Error(prop + " not found");
                return dataView[types[prop]](
                    splatIdx * row_offset + offsets[prop],
                    true,
                );
            },
        },
    );

    const numAttributes = 16;
    const splatsPerRow = Math.min(2048, numSplats);
    const textureWidth = splatsPerRow * (numAttributes / 4);
    const textureHeight = Math.ceil(numSplats / splatsPerRow);
    console.log(`Number of splats: ${numSplats}, Texture size: ${textureWidth}x${textureHeight}`);
    const splatData = new Float32Array(textureHeight * splatsPerRow * numAttributes);

    console.time("build buffer");
    for (splatIdx = 0; splatIdx < numSplats; splatIdx++) {
        let mean = vec3.fromValues(attrs.x, attrs.y, attrs.z);
        let quaternion = vec4.create();
        vec4.normalize(quaternion, vec4.fromValues(attrs.rot_1, attrs.rot_2, attrs.rot_3, attrs.rot_0));
        // let scales = vec3.fromValues(attrs.scale_0, attrs.scale_1, attrs.scale_2);
        let scales_raw = [Math.exp(attrs.scale_0), Math.exp(attrs.scale_1), Math.exp(attrs.scale_2)];
        if (convertToSurfels) {
            // find min scale and zero it
            let min_scale_ax = argMin(scales_raw);
            scales_raw[min_scale_ax] = 0.0;
        }
        let scales = vec3.fromValues(scales_raw[0], scales_raw[1], scales_raw[2]);
        let T = createT(quaternion, scales, mean);

        const SH_C0 = 0.28209479177387814;
        let rgba = vec4.fromValues(
            Math.min(Math.max(0.5 + SH_C0 * attrs.f_dc_0, 0.0), 1.0),
            Math.min(Math.max(0.5 + SH_C0 * attrs.f_dc_1, 0.0), 1.0),
            Math.min(Math.max(0.5 + SH_C0 * attrs.f_dc_2, 0.0), 1.0),
            // attrs.opacity
            1 / (1 + Math.exp(-attrs.opacity))
        );

        for (let j = 0; j < 12; j++) {
            splatData[splatIdx * numAttributes + j] = T[j];
        }
        for (let j = 12; j < 16; j++) {
            splatData[splatIdx * numAttributes + j] = rgba[j - 12];
        }
    }
    console.timeEnd("build buffer");

    return [splatData, textureWidth, textureHeight, numSplats];
}

const invertCol = (mat, col) => {
    mat[col + 0] = -mat[col + 0];
    mat[col + 4] = -mat[col + 4];
    mat[col + 8] = -mat[col + 8];
    mat[col + 12] = -mat[col + 12];
}

const scaleTranslation = (mat, scale) => {
    mat[12] *= scale;
    mat[13] *= scale;
    mat[14] *= scale;
}

const clampSmooth = (value, min, max) => {
    if (value < min) {
        value = value * 0.5 + min * 0.5;
    }
    if (value > max) {
        value = value * 0.5 + max * 0.5;
    }
    return value;
}

class GLOrbitControls {
    constructor(initialMatrix, focusPoint, globalUp) {
        this.dirty = false;
        this.matrix = mat4.clone(initialMatrix);
        this.focus = vec3.clone(focusPoint);
        this.globalUp = vec3.clone(globalUp);
        // Calculate initial position from view matrix
        let initial_c2w = mat4.create();
        mat4.invert(initial_c2w, initialMatrix);
        this.position = vec3.fromValues(
            initial_c2w[12],
            initial_c2w[13],
            initial_c2w[14]
        );
        // Compute initial pitch for clamping
        const toCamera = vec3.sub(vec3.create(), this.position, this.focus);
        vec3.normalize(toCamera, toCamera);
        this.currentPitch = -Math.asin(vec3.dot(toCamera, this.globalUp));
        // Set initial view matrix and initialize state
        this._updateViewMatrix();
        this.down = false;
        this.startX = 0;
        this.startY = 0;
        this.altX = 0;
        this.altY = 0;
        this.lastSumX = 0;
        this.lastSumY = 0;
    }

    initialize(canvas) {
        window.addEventListener("wheel", (e) => {
            e.preventDefault();
            const dx = e.deltaX / innerWidth;
            const dy = e.deltaY / innerHeight;
            if (e.shiftKey) {
                this._pan(dx * 4, dy * 4);
            } else if (e.ctrlKey) {
                this._zoom(1 + dy);
            } else {
                this._orbit(dx, dy);
            }
            this._updateViewMatrix();
        }, { passive: false });
        canvas.addEventListener("mousedown", (e) => {
            e.preventDefault();
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.down = 1;
        });
        canvas.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.down = 2;
        });
        canvas.addEventListener("mousemove", (e) => {
            e.preventDefault();
            const dx = (this.startX - e.clientX) / innerWidth;
            const dy = (this.startY - e.clientY) / innerHeight;
            if (this.down === 1) {
                this._orbit(dx * 4, dy * 4);
                this.startX = e.clientX;
                this.startY = e.clientY;
                this._updateViewMatrix();
            } else if (this.down === 2) {
                this._pan(dx * 4, dy * 4);
                this.startX = e.clientX;
                this.startY = e.clientY;
                this._updateViewMatrix();
            }
        });
        canvas.addEventListener("mouseup", (e) => {
            e.preventDefault();
            this.down = false;
            this.startX = 0;
            this.startY = 0;
        });
        canvas.addEventListener("touchstart", (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                this.startX = e.touches[0].clientX;
                this.startY = e.touches[0].clientY;
                this.down = 1;
            } else if (e.touches.length === 2) {
                this.startX = e.touches[0].clientX;
                this.altX = e.touches[1].clientX;
                this.startY = e.touches[0].clientY;
                this.altY = e.touches[1].clientY;
                this.down = 1;
            }
        }, { passive: false });
        canvas.addEventListener("touchmove", (e) => {
            e.preventDefault();
            if (e.touches.length === 1 && this.down) {
                const dx = (this.startX - e.touches[0].clientX) / innerWidth * 4;
                const dy = (this.startY - e.touches[0].clientY) / innerHeight * 4;
                this._orbit(dx, dy);
                this.startX = e.touches[0].clientX;
                this.startY = e.touches[0].clientY;
                this._updateViewMatrix();
            } else if (e.touches.length === 2) {
                // Pan based on movement of center of fingers
                const sumX = e.touches[0].clientX + e.touches[1].clientX;
                const sumY = e.touches[0].clientY + e.touches[1].clientY;
                const dcenterX = (this.lastSumX - sumX) / (innerWidth * 2);
                const dcenterY = (this.lastSumY - sumY) / (innerHeight * 2);
                this._pan(dcenterX * 40, dcenterY * 40);
                // Apply zoom based on distance between fingers
                const zoomFactor = Math.hypot(this.startX - this.altX, this.startY - this.altY) / Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                this._zoom(zoomFactor);
                // Update
                this.startX = e.touches[0].clientX;
                this.startY = e.touches[0].clientY;
                this.altX = e.touches[1].clientX;
                this.altY = e.touches[1].clientY;
                this.lastSumX = sumX;
                this.lastSumY = sumY;
                this._updateViewMatrix();
            }
        }, { passive: false });
        canvas.addEventListener("touchend", (e) => {
            e.preventDefault();
            this.down = false;
            this.startX = 0;
            this.startY = 0;
        }, { passive: false });
    }

    _getLocalRight() {
        const right = vec3.fromValues(this.matrix[0], this.matrix[4], this.matrix[8]);
        vec3.normalize(right, right);
        return right
    }

    _getLocalUp() {
        const up = vec3.fromValues(this.matrix[1], this.matrix[5], this.matrix[9]);
        vec3.normalize(up, up);
        return up
    }

    _orbit(dx, dy) {
        // Orbit around focus point
        const toCamera = vec3.sub(vec3.create(), this.position, this.focus);
        const radius = vec3.length(toCamera);
        // yaw around global up
        const yaw = mat4.rotate(mat4.create(), mat4.create(), dx, this.globalUp);
        vec3.transformMat4(toCamera, toCamera, yaw);
        // pitch around local right
        const proposedPitch = this.currentPitch + dy;
        const MAX_PITCH = Math.PI / 2.5;
        const clampedPitch = clampSmooth(proposedPitch, -MAX_PITCH, MAX_PITCH);
        const pitchDelta = clampedPitch - this.currentPitch;
        if (pitchDelta !== 0) {
            const right = this._getLocalRight();
            const pitch = mat4.rotate(mat4.create(), mat4.create(), pitchDelta, right);
            const testCamera = vec3.transformMat4(vec3.create(), toCamera, pitch);
            vec3.normalize(testCamera, testCamera);
            const upDot = Math.abs(vec3.dot(testCamera, this.globalUp));
            if (upDot < 0.99) {
                vec3.copy(toCamera, testCamera);
                this.currentPitch = clampedPitch;
            }
        }
        // old pitch code without clamping
        // const pitch = mat4.rotate(mat4.create(), mat4.create(), dy, this._getLocalRight());
        // vec3.transformMat4(toCamera, toCamera, pitch);
        vec3.normalize(toCamera, toCamera);
        vec3.scale(toCamera, toCamera, radius);
        vec3.add(this.position, this.focus, toCamera);
    }

    _pan(dx, dy) {
        // Equally move focus point and camera in view plane
        const moveX = vec3.scale(vec3.create(), this._getLocalRight(), dx);
        const moveY = vec3.scale(vec3.create(), this._getLocalUp(), -dy);
        vec3.add(this.focus, this.focus, moveX);
        vec3.add(this.focus, this.focus, moveY);
        vec3.add(this.position, this.position, moveX);
        vec3.add(this.position, this.position, moveY);
    }

    _zoom(factor) {
        // Move closer/further from focus point along view direction
        const toCamera = vec3.sub(vec3.create(), this.position, this.focus);
        vec3.scale(toCamera, toCamera, factor);
        vec3.add(this.position, this.focus, toCamera);
    }

    _updateViewMatrix() {
        mat4.lookAt(this.matrix, this.position, this.focus, this.globalUp);
        this.dirty = true;
    }

    getViewMatrix() {
        this.dirty = false;
        return this.matrix;
    }

    wasChanged() {
        return this.dirty;
    }
}