import { prepare } from './canvas.js';
import { colors, hueColor, rgba } from './theme.js';

// Desenul arenei: obiectele (în nuanța pe care o percepe organismul), organismul,
// raza percepției și liniile atenției.
export class ArenaView {
  constructor(canvas) {
    this.canvas = canvas;
    this.pulse = 0;
  }

  draw(sim, observer, realDt) {
    const { ctx, w, h } = prepare(this.canvas);
    const c = colors();
    const world = sim.world;
    const s = w / world.bounds.width;
    const org = sim.organism;
    const brain = org.brain;
    const X = (x) => x * s;
    const Y = (y) => y * s;

    ctx.fillStyle = c['arena-bg'];
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = c['arena-grid'];
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 10; gx < world.bounds.width; gx += 10) {
      ctx.moveTo(Math.round(X(gx)) + 0.5, 0);
      ctx.lineTo(Math.round(X(gx)) + 0.5, h);
    }
    for (let gy = 10; gy < world.bounds.height; gy += 10) {
      ctx.moveTo(0, Math.round(Y(gy)) + 0.5);
      ctx.lineTo(w, Math.round(Y(gy)) + 0.5);
    }
    ctx.stroke();

    const mod = brain.mod;
    const ox = X(org.x);
    const oy = Y(org.y);

    // raza percepției
    if (mod && org.alive) {
      ctx.beginPath();
      ctx.arc(ox, oy, mod.range * s, 0, Math.PI * 2);
      ctx.fillStyle = c.dark ? 'rgba(255,255,255,0.025)' : 'rgba(15,23,21,0.03)';
      ctx.fill();
      ctx.strokeStyle = c.dark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,21,0.10)';
      ctx.stroke();
    }

    // liniile atenției
    if (org.alive) {
      for (const pc of brain.attended) {
        if (!brain.percepts.has(pc.id)) continue;
        const target = brain.action.targetId === pc.id;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(X(pc.x), Y(pc.y));
        if (target) {
          ctx.strokeStyle = brain.action.type === 'avoid' ? c['a-avoid'] : c.accent;
          ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = c.dark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,21,0.16)';
          ctx.lineWidth = 1;
        }
        ctx.stroke();
      }
    }

    // efecte recente: consum
    for (const e of world.events) {
      if (e.type !== 'consume') continue;
      const age = world.time - e.time;
      if (age > 1.2) continue;
      const kind = world.kinds[e.kind];
      ctx.beginPath();
      ctx.arc(X(e.x), Y(e.y), (kind.radius + age * 4) * s, 0, Math.PI * 2);
      ctx.strokeStyle = hueColor(kind.hue, { alpha: Math.max(0, 0.7 - age * 0.6) });
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // obiectele
    for (const o of world.objects) this.drawObject(ctx, o, X(o.x), Y(o.y), o.radius * s, org, s, c);

    // intervenția îngrijitorului
    const care = sim.caregiver.interventions;
    const lastCare = care.length ? care[care.length - 1] : null;
    if (lastCare && sim.time - lastCare.time < 2.5) {
      const age = sim.time - lastCare.time;
      const r = (6 + age * 2) * s;
      const grad = ctx.createRadialGradient(ox, oy, r * 0.2, ox, oy, r);
      grad.addColorStop(0, hueColor(40, { sat: 80, light: 62, alpha: 0.35 * (1 - age / 2.5) }));
      grad.addColorStop(1, hueColor(40, { sat: 80, light: 62, alpha: 0 }));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c['ink-2'];
      ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lastCare.type === 'feed' ? 'îngrijitorul îl hrănește' : 'îngrijitorul îl salvează', ox, oy - r - 4);
    }

    this.drawOrganism(ctx, org, ox, oy, s, c, observer, sim, realDt);
  }

  drawObject(ctx, o, x, y, r, org, s, c) {
    ctx.save();
    switch (o.kind) {
      case 'nutrient':
      case 'husk': {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = hueColor(o.hue, { sat: 58, light: 44 });
        ctx.fill();
        if (o.kind === 'husk') {
          // vizibil doar pentru observator: organismul nu o poate deosebi de hrană
          ctx.beginPath();
          ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
          ctx.fillStyle = c['arena-bg'];
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fill();
        }
        break;
      }
      case 'thorn': {
        const spikes = 9;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const a = (Math.PI * i) / spikes + o.id;
          const rr = i % 2 === 0 ? r * 1.15 : r * 0.55;
          const px = x + Math.cos(a) * rr;
          const py = y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = hueColor(o.hue, { sat: 68, light: 48 });
        ctx.fill();
        break;
      }
      case 'stone': {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6 + o.id * 0.7;
          const rr = r * (0.85 + 0.15 * Math.sin(o.id * 3 + i));
          if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = hueColor(o.hue, { sat: 16, light: 58 });
        ctx.fill();
        break;
      }
      case 'substance': {
        const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.6);
        glow.addColorStop(0, hueColor(o.hue, { sat: 70, light: 58, alpha: 0.35 }));
        glow.addColorStop(1, hueColor(o.hue, { sat: 70, light: 58, alpha: 0 }));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.25);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r * 1.25);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fillStyle = hueColor(o.hue, { sat: 62, light: 52 });
        ctx.fill();
        break;
      }
      case 'predator': {
        const a = Math.atan2(org.y - o.y, org.x - o.x);
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(r * 1.5, 0);
        ctx.lineTo(-r, r * 0.95);
        ctx.lineTo(-r * 0.55, 0);
        ctx.lineTo(-r, -r * 0.95);
        ctx.closePath();
        ctx.fillStyle = hueColor(o.hue, { sat: 76, light: 48 });
        ctx.fill();
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  drawOrganism(ctx, org, x, y, s, c, observer, sim, realDt) {
    const endo = org.endocrine;
    const radius = org.radius * (0.55 + 0.45 * org.maturation) * s * 1.15;
    // pulsul membranei urmează noradrenalina (ritmul "cardiac")
    const rate = 1.2 + 4 * Math.min(endo.noradrenaline, 1.4);
    this.pulse += (realDt || 0.016) * rate * Math.PI * 2 * (sim.time > 0 ? 1 : 0.3);
    const beat = org.alive ? 1 + 0.06 * Math.sin(this.pulse) : 1;

    // halou dopaminergic
    if (org.alive) {
      const da = Math.min(endo.daNorm, 3);
      const glowR = radius * (1.6 + 0.5 * da);
      const g = ctx.createRadialGradient(x, y, radius * 0.6, x, y, glowR);
      g.addColorStop(0, rgba(c['h-dopamine'], Math.min(0.6, 0.12 + da * 0.14)));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // durere recentă
    const lastPain = observer.painLog.length ? observer.painLog[observer.painLog.length - 1] : -Infinity;
    if (org.alive && sim.time - lastPain < 0.8) {
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.9, 0, Math.PI * 2);
      ctx.strokeStyle = c.critical;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, radius * beat, 0, Math.PI * 2);
    ctx.fillStyle = org.alive ? c.organism : c.muted;
    ctx.fill();

    // direcția mișcării
    const sp = Math.hypot(org.vx, org.vy);
    if (org.alive && sp > 0.05) {
      const a = Math.atan2(org.vy, org.vx);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * radius * 0.55, y + Math.sin(a) * radius * 0.55, radius * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = c['arena-bg'];
      ctx.fill();
    }
  }
}
