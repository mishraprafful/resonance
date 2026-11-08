(() => {
  const STEPS = 200;
  const THEME_KEY = "rsn-theme";
  const root = document.documentElement;
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const RAMPS = {
    dark: [
      [0, [10, 12, 16]],
      [0.3, [37, 30, 92]],
      [0.55, [96, 82, 224]],
      [0.75, [139, 123, 255]],
      [0.9, [45, 226, 196]],
      [1, [234, 255, 251]],
    ],
    light: [
      [0, [238, 240, 245]],
      [0.3, [221, 214, 254]],
      [0.55, [139, 123, 255]],
      [0.75, [91, 71, 224]],
      [0.9, [15, 118, 110]],
      [1, [4, 47, 46]],
    ],
  };

  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.appendChild(probe);

  function cssColor(name) {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  }

  function resolvedTheme() {
    return root.dataset.theme || (darkQuery.matches ? "dark" : "light");
  }

  function colormap(v, ramp) {
    const x = Math.min(1, Math.max(0, v));
    for (let i = 1; i < ramp.length; i++) {
      const [p1, c1] = ramp[i];
      const [p0, c0] = ramp[i - 1];
      if (x <= p1) {
        const t = (x - p0) / (p1 - p0);
        return c0.map((c, k) => c + (c1[k] - c) * t);
      }
    }
    return ramp[ramp.length - 1][1];
  }

  function seeded(seed) {
    let a = seed + 0x6d2b79f5;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    return canvas.getContext("2d");
  }

  function drawSpectrogram(canvas, step) {
    const ctx = fit(canvas);
    if (!ctx) return;
    const cols = 220;
    const bins = 90;
    const noise = 0.5 * (1 - step / STEPS) + 0.04;
    const rand = seeded(step);
    const ramp = RAMPS[resolvedTheme()];
    const img = ctx.createImageData(cols, bins);
    for (let x = 0; x < cols; x++) {
      const t = x / cols;
      const f0 = 14 + 5 * Math.sin(t * Math.PI * 2.2) + 2 * Math.sin(t * 17);
      for (let y = 0; y < bins; y++) {
        const bin = bins - 1 - y;
        let v = 0;
        for (let h = 1; h <= 5; h++) {
          const d = bin - f0 * h;
          v += Math.exp(-(d * d) / (2.2 + h)) * (1 / h);
        }
        v = v * (0.85 + 0.15 * Math.sin(t * 40)) + noise * rand() * (1 - bin / bins);
        const [r, g, b] = colormap(Math.pow(v, 0.8), ramp);
        const i = (y * cols + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    const off = document.createElement("canvas");
    off.width = cols;
    off.height = bins;
    off.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  function drawWaveform(canvas, step) {
    const ctx = fit(canvas);
    if (!ctx) return;
    const { width, height } = canvas;
    const dpr = window.devicePixelRatio || 1;
    const bar = 3 * dpr;
    const gap = 2 * dpr;
    const n = Math.floor(width / (bar + gap));
    const rand = seeded(step + 1000);
    const noise = 0.45 * (1 - step / STEPS);
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, cssColor("--accent"));
    grad.addColorStop(1, cssColor("--accent-2"));
    ctx.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = 0.35 + 0.3 * Math.abs(Math.sin(t * Math.PI * 3.1)) + 0.12 * Math.sin(t * 29);
      const a = Math.min(0.95, Math.max(0.06, env + noise * (rand() - 0.5)));
      const h = a * height;
      ctx.fillRect(i * (bar + gap), (height - h) / 2, bar, h);
    }
  }

  const wave = document.getElementById("wave");
  const spec = document.getElementById("spec");
  const slider = document.getElementById("step");
  const out = document.getElementById("step-out");

  function render() {
    const step = Number(slider.value);
    out.textContent = `${step} / ${STEPS}`;
    drawWaveform(wave, step);
    drawSpectrogram(spec, step);
  }

  if (wave && spec && slider && out) {
    slider.addEventListener("input", render);
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 120);
    });
    render();

    const heads = document.querySelectorAll("[data-playhead]");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      heads.forEach((h) => (h.style.left = "36%"));
    } else {
      const period = 7000;
      const tick = (now) => {
        const pct = ((now % period) / period) * 100;
        heads.forEach((h) => (h.style.left = `${pct}%`));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  const themeButtons = document.querySelectorAll("[data-theme-choice]");

  function applyTheme(choice) {
    if (choice === "light" || choice === "dark") root.dataset.theme = choice;
    else delete root.dataset.theme;
    themeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeChoice === choice)));
    if (wave && spec && slider && out) render();
  }

  themeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const choice = btn.dataset.themeChoice;
      applyTheme(choice);
      try {
        if (choice === "system") localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, choice);
      } catch {}
    });
  });

  darkQuery.addEventListener("change", () => {
    if (!root.dataset.theme && wave && spec && slider && out) render();
  });

  applyTheme(root.dataset.theme || "system");

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const src = document.getElementById(btn.dataset.copy);
      if (!src) return;
      try {
        await navigator.clipboard.writeText(src.textContent);
        btn.textContent = "copied";
      } catch {
        btn.textContent = "select + copy";
      }
      setTimeout(() => (btn.textContent = "copy"), 1600);
    });
  });
})();
