# Egg Drop Challenge Simulator

A browser-based 2D egg drop challenge prototype. It loads a transparent image silhouette, interprets non-transparent pixels as a protective structure, and estimates the protection effectiveness with a one-axis impact model.

## Run

Open `index.html` directly in a browser, or serve the directory with any static file server:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Design image format

- Initial simulation target: **64 px wide × 256 px high**.
- Transparent pixels (`alpha = 0`) are ignored.
- The egg starts at the top center of the assembly.
- Red controls stiffness.
- Green controls damping and crush stroke.
- Blue controls shear failure strain and shear energy absorption.

Example material colors shown in the app include balsa, toothpicks, plastic straws, paper/card webbing, foam, and rubber bands.

## Outputs

- Impact animation.
- Score and survival/break status.
- Peak egg g-force and assembly force metrics.
- Force-over-time plots for the assembly and egg.
- CSV report export.

## Model scope

This is an early, one-axis impact model using a rigid floor, default gravity, a circular egg approximation, and a Planck.js-backed animation world. The crush/shear material model is intentionally transparent and tunable rather than a validated engineering predictor.
