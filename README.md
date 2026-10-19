# Wavr

Generate, draw and graph audio waves right in your browser. Wavr is a small, dependency-free tool built on the Web Audio API: pick a waveform, draw your own, or type an equation and hear what it sounds like, while watching the wave, an oscilloscope and a spectrum analyzer.

No build step, no frameworks, no server. Three static files.

## Features

### 1. Simple mode
- 15 waveforms: sine, square, triangle, sawtooth, reverse saw, pulse 25 %, pulse 10 %, half-wave, full-wave, staircase, trapezoid, parabolic, organ, overdrive, white noise, plus **PWM**.
- **PWM width** slider (1 to 99 %) appears when PWM is selected.
- Frequency from 20 Hz to 20 kHz (logarithmic slider or exact number) and amplitude.
- Each waveform has a live preview in the picker.

### 2. Advanced mode
- **Draw one cycle** by dragging on the canvas. The cycle loops at the chosen frequency.
- **Harmonics 1 to 16** sliders build a wave from sine partials.
- Presets (sine, square, triangle, saw, random) and a smoothing button.
- The volume matches what you draw. A flat line is silent.

### 3. Math mode
Type an equation in `x`, for example `sin(2*pi*x)`, `x^2` or `exp(-6*x)*sin(2*pi*220*x)`.

- **Domain and range:** choose x min / x max, and either let y auto-scale or set y min / y max (values outside are clipped).
- **x means**
  - **Seconds**: `x` is real time. The domain is one looping chunk (up to 10 s), so its length sets the loop rate (1 / length).
  - **Cycle at pitch**: the whole domain is stretched into one cycle played at a pitch you choose (default 220 Hz). The shape of the graph becomes the sound, so even non-periodic graphs like `x^2` are audible.
- **A · As is**: plays the graph exactly as written.
- **B · Embed in carrier** (Seconds mode): multiplies the equation by a carrier, `(equation) * sin(2*pi*f*x)` (440 Hz by default), so slow graphs become audible as the volume envelope of a tone. The added term is highlighted in a box.
- **Notes**: Wavr tells you when a graph isn't periodic (the ends don't meet), when its dominant pitch is outside hearing range, when values are undefined, or when your y range clips the wave. You can still play it.
- **Autocomplete**: unobtrusive suggestion chips appear under the field; press `Tab` to accept the first, `Esc` to dismiss.

**Supported syntax**

| | |
|---|---|
| Operators | `+ - * / % ^` and implicit multiplication (`2x`, `2pi`) |
| Functions | `sin cos tan asin acos atan atan2 sinh cosh tanh abs sqrt exp ln log log10 log2 floor ceil round sign min max pow mod fract` |
| Constants | `pi`, `e`, `tau` |

`log` is the natural logarithm. Equations are parsed by a small built-in parser, never with `eval`.

### Visualization
- **Wave shape**: one cycle (or the whole domain in Math mode).
- **Oscilloscope**: live, with a rising-edge trigger.
- **Spectrum**: live FFT on a log frequency axis (20 Hz to 20 kHz).

### Other
- Light and dark theme (follows your system, remembered in `localStorage`).
- A built-in limiter and a perceptual volume curve keep output safe.
- Responsive layout; respects `prefers-reduced-motion`.

## Run it

Open `index.html` in a modern browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Browsers only start audio after a user gesture, so press **Play** first.

## Deploy on GitHub Pages

1. Push the files to a repository.
2. In **Settings → Pages**, choose your branch and the `/ (root)` folder.
3. Your site will be at `https://<user>.github.io/<repo>/`.

## Project structure

```
index.html   markup: two panels (wave formation, visualization)
style.css    styles; all colours are theme variables (light and dark)
app.js       all behaviour, in labelled sections
```

## How it works

- **Simple and Advanced** modes sample one cycle into a table, take its DFT (up to 512 harmonics) and play it with an `OscillatorNode` using a `PeriodicWave`. Normalization is disabled so amplitude stays true to the drawing; Simple mode scales to a peak of 1.
- **Math** mode evaluates the equation into a looping `AudioBuffer`, scales it to the y range, and sets `playbackRate` so the loop runs at exactly 1 / duration (or at your chosen pitch).
- **Noise** is a looped buffer of random samples.
- Output chain: source → fade gain → amplitude → compressor (limiter) → master volume → analyser → speakers.

## Browser support

Recent Chrome, Edge, Firefox and Safari (Web Audio API and the `AudioBuffer` constructor are required).

## Contributing

Issues and pull requests are welcome. The project intentionally has no dependencies or build tooling, so please keep it that way.

## License

[MIT](LICENSE)
