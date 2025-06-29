# Ray Tracing 3D Gaussians in WebGL using Depth Testing

A WebGL viewer that uses perspective-correct ray casting (aka ray tracing) to evaluate Gaussians in 3D.
It is based on [this paper](https://fhahlbohm.github.io/htgs/) but uses depth testing instead of sorting.
Gaussians are also truncated at 2σ (usually ~3.33σ) to improve visual fidelity.

*Note:* The viewer is compatible with any .ply file in the INRIA format and will render the actual 3D Gaussians as they are defined in the .ply file.
This means that models trained using methods which do not use an exact method for rendering (e.g., standard 3DGS), might not look as expected.


## Setup
1. Clone the repository
2. Download [this exemplary .ply file](https://cloud.tu-braunschweig.de/s/Z2d7RKS9Y6kTQNz) into the root directory of the repository
3. Serve the root directory of this repository, e.g., with `python -m http.server` or the solution in [#1](https://github.com/fhahlbohm/depthtested-gaussian-raytracing-webgl/issues/1)
4. Open the `index.html` file in Chrome (other browsers may work as well, but are not tested)
5. (optional) Modify the constants at the top of `main.js`
6. (advanced) Modify the constants inside the vertex/fragment shader in `shaders/` to adjust the cutoff for Gaussians


## More .ply files (trained with HTGS)

- [Mip-NeRF360 / Tanks&Temples](https://cloud.tu-braunschweig.de/s/d3waK4P6TxAGASP)
- [Gauss](https://cloud.tu-braunschweig.de/s/bCdnKQ8Bsz9ombw)


## Open problems

- [ ] configurable sh evaluation
- [ ] make work on mobile devices (probably requires to switch to a different texture format)
- [ ] compression of .ply and attributes in buffers


## License and citation

This project is licensed under the MIT license (see [LICENSE](LICENSE)).

If you use this code for your research projects, please consider a citation:
```bibtex
@article{hahlbohm2025htgs,
  title = {Efficient Perspective-Correct 3D Gaussian Splatting Using Hybrid Transparency}, 
  author = {Hahlbohm, Florian and Friederichs, Fabian and Weyrich, Tim and Franke, Linus and Kappel, Moritz and Castillo, Susana and Stamminger, Marc and Eisemann, Martin and Magnor, Marcus},
  journal = {Computer Graphics Forum},
  volume = {44},
  number = {2},
  doi = {10.1111/cgf.70014},
  year = {2025},
  url = {https://fhahlbohm.github.io/htgs/}
}
```
