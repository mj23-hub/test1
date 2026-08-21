(function () {
  const COLORS = ['#5a4de8', '#4f6ee8', '#5b9bf0', '#ffd166', '#ff6b6b', '#5ce1a0', '#ffffff'];

  function spawnBurst(particles, cx, cy) {
    const count = 40 + Math.floor(Math.random() * 20);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha: 1,
        size: 2 + Math.random() * 2,
      });
    }
  }

  window.launchFireworks = function launchFireworks() {
    const existing = document.getElementById('fireworks-overlay');
    if (existing) existing.remove();

    const canvas = document.createElement('canvas');
    canvas.id = 'fireworks-overlay';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    let particles = [];
    const bursts = 5;
    for (let b = 0; b < bursts; b++) {
      setTimeout(() => {
        spawnBurst(
          particles,
          window.innerWidth * (0.25 + Math.random() * 0.5),
          window.innerHeight * (0.2 + Math.random() * 0.35)
        );
      }, b * 350);
    }

    const startedAt = Date.now();
    const maxDurationMs = bursts * 350 + 2200;

    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05; // gravity
        p.alpha -= 0.012;
        ctx.globalAlpha = Math.max(p.alpha, 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      particles = particles.filter((p) => p.alpha > 0);
      ctx.globalAlpha = 1;

      if (Date.now() - startedAt < maxDurationMs || particles.length > 0) {
        requestAnimationFrame(tick);
      } else {
        canvas.remove();
      }
    }
    tick();
  };
})();
