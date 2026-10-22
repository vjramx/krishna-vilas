/**
 * FireflyFx — the firefly sign-in ambience.
 *
 * Adapted from the "Firefly Login V3" demo (by @codinvisual, freely reusable):
 * one working firefly drifts over the sign-in sheet, lands on whichever field
 * you touch, follows the caret as you type, dives into the password and lights
 * every dot, honours the eye toggle, and fills the submit button with light on
 * sign-in — with two colony fireflies, a wood of far-off lights and a night
 * overlay that cuts its own holes around every light.
 *
 * Adaptations for this app:
 *  - Lamp-amber light instead of the demo's lime green (brand palette).
 *  - Coordinates are computed against the `.ff-stage` box, not the viewport:
 *    the night mask, colony and wood live inside the stage while the firefly
 *    itself is viewport-fixed.
 *  - All thresholds, easing and reduced-motion behaviour follow the source
 *    constants below; everything is decorative and pointer-transparent.
 *
 * The component renders only overlays; the form fields, eye toggle and submit
 * button stay owned by LoginPage, which passes their refs here.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** Seconds for the firefly to settle on its goal (critically damped spring). */
const RESP = 0.34;
/** Spring looseness in the victory constellation — the one place it overshoots. */
const BOUNCE = 0.62;
/** Flight speed (px/s) where a fading trail starts. */
const TRAIL = 130;
/** Seconds one keystroke pulse of light lasts. */
const PULSE = 0.14;

export interface FireflyRefs {
  form: RefObject<HTMLFormElement>;
  email: RefObject<HTMLInputElement>;
  pass: RefObject<HTMLInputElement>;
  passField: RefObject<HTMLDivElement>;
  dots: RefObject<HTMLSpanElement>;
  text: RefObject<HTMLSpanElement>;
  caret: RefObject<HTMLElement>;
  eye: RefObject<HTMLButtonElement>;
  send: RefObject<HTMLButtonElement>;
}

interface Engine {
  celebrate: () => void;
}

/**
 * canvas measureText when available (real browsers); a fixed-width estimate
 * when not — jsdom's getContext returns null, and caret following must not
 * crash the tests on its account.
 */
function makePen(): (v: string) => number {
  // jsdom reports canvas 2d as "not implemented" through its console; skip it
  // in tests so the caret width falls back to the estimate silently.
  if (import.meta.env.MODE === 'test') {
    return (v) => v.length * 8.8;
  }
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (c) {
      c.font = '500 16px Roboto, "Noto Sans Kannada", system-ui, sans-serif';
      return (v) => {
        try {
          return c.measureText(v).width;
        } catch {
          return v.length * 8.8;
        }
      };
    }
  } catch {
    /* no canvas — tests */
  }
  return (v) => v.length * 8.8;
}

/** Element placements use `style.translate` where supported, else transform. */
function place(el: HTMLElement, tx: number, ty: number) {
  try {
    el.style.translate = `${tx}px ${ty}px`;
  } catch {
    el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
  }
}

export function FireflyFx({ refs, celebrate }: { refs: FireflyRefs; celebrate: boolean }) {
  const airRef = useRef<HTMLDivElement | null>(null);
  const colonyRef = useRef<HTMLDivElement | null>(null);
  const nightRef = useRef<HTMLDivElement | null>(null);
  const sparkRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const celebratedRef = useRef(false);

  // FireflyRefs holds stable RefObjects — the effect runs once.
  useEffect(() => {
    const stage = airRef.current?.parentElement;
    const spark = sparkRef.current;
    const night = nightRef.current;
    const airEl = airRef.current;
    const colonyEl = colonyRef.current;
    if (!stage || !spark || !night || !airEl || !colonyEl) return;
    const flies = Array.from(colonyEl.children) as HTMLElement[];

    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const width = makePen();

    const owns: Array<() => void> = [];
    const timers: number[] = [];
    const transient: HTMLElement[] = [];
    let rafId = 0;

    const on = (el: HTMLElement | Document | null, type: string, fn: EventListener) => {
      if (!el) return;
      el.addEventListener(type, fn);
      owns.push(() => el.removeEventListener(type, fn));
    };

    let x = -80;
    let y = window.innerHeight / 2;
    let vx = 0;
    let vy = 0;
    let goal = { x, y };
    let dive: HTMLElement | null = null;
    let idle = true;
    let party = false;
    let pulseT = 0;

    const at = (el: HTMLElement, kind: 'email' | 'pass' | 'center') => {
      const r = el.getBoundingClientRect();
      if (kind === 'center') return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      return { x: r.left + 22, y: r.top - 4 }; // it lands on top of a field
    };

    const kindOf = (t: EventTarget | null): { el: HTMLElement; kind: 'email' | 'pass' | 'center' } | null => {
      if (!(t instanceof HTMLElement)) return null;
      if (t === refs.email.current) return { el: t, kind: 'email' };
      if (t === refs.pass.current) return { el: t, kind: 'pass' };
      if (t === refs.eye.current || t === refs.send.current) return { el: t, kind: 'center' };
      return null;
    };

    /** While you type it follows the last character. */
    const caretGoal = (input: HTMLInputElement, kind: 'email' | 'pass') => {
      const r = input.getBoundingClientRect();
      const v = input.value;
      const span = Math.max(r.width - 70, 40);
      if (kind === 'email') return { x: r.left + 24 + Math.min(width(v), span), y: r.top - 4 };
      const shown = refs.passField.current?.classList.contains('show') ?? false;
      const w = shown ? width(v) + v.length * 0.5 : Math.max(v.length * 14 - 7, 6);
      return { x: r.left + 18 + Math.min(w, span), y: r.top + r.height / 2 };
    };

    let step = 0;

    /** One short pulse of light per key, on the same frame as the key. */
    const pulse = () => {
      spark.style.setProperty('--pulse', '1');
      window.clearTimeout(pulseT);
      pulseT = window.setTimeout(() => spark.style.setProperty('--pulse', '0'), PULSE * 1000);
    };

    const flyMeta = flies.map((el, i) => ({
      el,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      seed: i * 3.1,
      look: 0,
      init: false,
    }));
    const lookAt = (ms = 900) => {
      const until = performance.now() + ms;
      for (const f of flyMeta) f.look = until;
    };

    const paintPassword = (fresh: boolean) => {
      const pass = refs.pass.current;
      const dots = refs.dots.current;
      const textEl = refs.text.current;
      const caret = refs.caret.current;
      const pf = refs.passField.current;
      if (!pass || !dots || !textEl || !caret || !pf) return;
      const v = [...pass.value];
      const carry = (node: HTMLElement, i: number) => {
        if (fresh && i === v.length - 1) node.className = 'new';
        return node;
      };
      dots.replaceChildren(...v.map((_, i) => carry(document.createElement('i'), i)));
      textEl.replaceChildren(
        ...v.map((ch, i) => {
          const b = carry(document.createElement('b'), i);
          b.textContent = ch;
          return b;
        }),
      );
      place(caret, pf.classList.contains('show') ? textEl.offsetWidth : v.length * 14, 0);
    };

    const diveIntoPassword = () => {
      const pass = refs.pass.current;
      const pf = refs.passField.current;
      if (!pass || !pf) return;
      if (!pass.value) {
        if (dive === pf) dive = null;
        pf.classList.remove('inside');
        goal = at(pass, 'pass');
        return;
      }
      if (dive !== pf) lookAt(1100);
      dive = pf;
      goal = caretGoal(pass, 'pass');
    };

    const idleGoal = (now: number) => {
      const r = refs.form.current?.getBoundingClientRect();
      if (!r || r.width === 0) {
        // Measuring failed (tests): circle above centre instead of hard zeros.
        return { x: window.innerWidth / 2, y: Math.max(window.innerHeight * 0.28 + Math.sin(now * 0.00052) * 30, 0) };
      }
      return {
        x: r.left + r.width * (0.5 + 0.4 * Math.sin(now * 0.00037)),
        y: r.top - 26 + Math.sin(now * 0.00052) * 30,
      };
    };

    interface Mote {
      el: HTMLElement;
      kind: 'far' | 'mote';
      sx: number;
      sy: number;
      seed: number;
      x0: number;
      y0: number;
      rise: number;
      life: number;
      born: number;
    }
    const motes: Mote[] = [];
    const buildAir = (cls: 'far' | 'mote', n: number) => {
      for (let i = 0; i < n; i++) {
        const el = document.createElement('i');
        el.className = `${cls}${Math.random() < 0.38 ? ' warm' : ''}`;
        airEl.append(el);
        motes.push({
          el,
          kind: cls,
          sx: 0.5 + Math.random(),
          sy: 0.4 + Math.random() * 0.8,
          seed: Math.random() * 6.28,
          x0: Math.random(),
          y0: Math.random(),
          rise: cls === 'mote' ? 40 + Math.random() * 90 : 0,
          life: 5 + Math.random() * 5,
          born: Math.random() * 10,
        });
      }
    };
    buildAir('far', 16);
    buildAir('mote', 18);

    /** Far-off lights out of focus and slow motes of pollen — all decoration. */
    const wood = (now: number, sw: number, sh: number) => {
      const t = now / 1000;
      for (const a of motes) {
        if (reduce) {
          a.el.style.opacity = a.kind === 'mote' ? '0.3' : '0.5';
          place(a.el, a.x0 * sw, a.y0 * sh);
          continue;
        }
        const px = a.x0 * sw + Math.sin(t * 0.22 * a.sx + a.seed) * 26;
        const py = a.y0 * sh + Math.sin(t * 0.18 * a.sy + a.seed * 1.7) * 22;
        let o = 1;
        if (a.kind === 'mote') {
          // Motes lift, fade in and out, and start over.
          const k = ((t - a.born) % a.life) / a.life;
          const yy = py - k * a.rise * 3;
          o = Math.sin(Math.PI * k) * (0.45 + 0.55 * Math.sin(t * 1.6 + a.seed));
          a.el.style.opacity = Math.max(0, o).toFixed(3);
          place(a.el, px, yy);
        } else {
          o = 0.5 + 0.5 * Math.sin(t * 0.8 + a.seed);
          a.el.style.opacity = Math.max(0, o).toFixed(3);
          place(a.el, px, py);
        }
      }
    };

    /** Two colony fireflies on a lazy drift behind the glass. */
    const colonyStep = (now: number, srLeft: number, srTop: number, sw: number, sh: number) => {
      const dt = 1 / 60;
      for (const f of flyMeta) {
        const dx = 0.5 + 0.3 * Math.sin(now * 0.00021 + f.seed) + 0.06 * Math.sin(now * 0.00083 + f.seed * 2);
        const dy = 0.5 + 0.26 * Math.sin(now * 0.00017 + f.seed * 1.7) + 0.05 * Math.sin(now * 0.00071 + f.seed);
        let gx = sw * dx;
        let gy = sh * dy;
        if (reduce) {
          place(f.el, gx, gy);
          night.style.setProperty(f.seed ? '--ax' : '--bx', `${gx}px`);
          night.style.setProperty(f.seed ? '--ay' : '--by', `${gy}px`);
          continue;
        }
        if (party) {
          // The three hold a constellation over the submit button.
          const r = refs.send.current?.getBoundingClientRect();
          if (r) {
            gx = r.left - srLeft + r.width / 2 + (f.seed ? 86 : -86);
            gy = r.top - srTop - 34;
          }
        } else if (now < f.look) {
          // They turn to the working light when something happens.
          gx += (x - srLeft + Math.cos(f.seed + now * 0.001) * 96 - gx) * 0.8;
          gy += (y - srTop + Math.sin(f.seed + now * 0.001) * 72 - gy) * 0.8;
        }
        if (!f.init) {
          f.x = gx;
          f.y = gy;
          f.init = true;
        }
        const w = (2 * Math.PI) / (party ? 0.55 : 1.7);
        f.vx += (w * w * (gx - f.x) - 2 * w * f.vx) * dt;
        f.vy += (w * w * (gy - f.y) - 2 * w * f.vy) * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        place(f.el, f.x, f.y);
        night.style.setProperty(f.seed ? '--ax' : '--bx', `${f.x}px`);
        night.style.setProperty(f.seed ? '--ay' : '--by', `${f.y}px`);
      }
    };

    /** A faint dot left behind on fast flight; it fades like light on the retina. */
    const trail = (tx: number, ty: number) => {
      const d = document.createElement('i');
      d.className = 'ff-trail';
      d.style.left = `${tx}px`;
      d.style.top = `${ty}px`;
      document.body.append(d);
      transient.push(d);
      const clear = () => {
        d.remove();
        const i = transient.indexOf(d);
        if (i >= 0) transient.splice(i, 1);
      };
      if (typeof d.animate === 'function') {
        d.animate([{ opacity: 0.9, scale: 1 }, { opacity: 0, scale: 0.4 }], { duration: 420, easing: 'ease-out' }).onfinish =
          clear;
      } else {
        window.setTimeout(clear, 440);
      }
    };

    const burst = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      for (let i = 0; i < 28; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.9;
        const dist = 40 + 110 * Math.random();
        const s = document.createElement('span');
        s.className = 'ff-ember';
        s.style.left = `${r.left + r.width / 2 + side * r.width * (0.15 + 0.3 * Math.random())}px`;
        s.style.top = `${r.top + r.height / 2}px`;
        document.body.append(s);
        transient.push(s);
        const clear = () => {
          s.remove();
          const ix = transient.indexOf(s);
          if (ix >= 0) transient.splice(ix, 1);
        };
        if (typeof s.animate === 'function') {
          s.animate(
            [
              { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
              {
                transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${
                  Math.sin(ang) * dist * 0.8 + 20
                }px)) scale(0.4)`,
                opacity: 0,
              },
            ],
            {
              duration: 700 + 500 * Math.random(),
              delay: Math.random() * 120,
              easing: 'cubic-bezier(.23, 1, .32, 1)',
              fill: 'backwards',
            },
          ).onfinish = clear;
        } else {
          window.setTimeout(clear, 900);
        }
      }
    };

    const celebrateNow = () => {
      idle = false;
      const send = refs.send.current;
      if (!send) {
        night.classList.add('day');
        return;
      }
      const r = send.getBoundingClientRect();
      goal = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      dive = send;
      // Fill once the dive has visibly landed: light radiates from there.
      timers.push(
        window.setTimeout(() => {
          const rr = send.getBoundingClientRect();
          send.style.setProperty('--hx', `${Math.min(Math.max(x - rr.left, 4), Math.max(rr.width - 4, 4))}px`);
          send.classList.add('done');
          night.classList.add('day');
          party = true;
          lookAt(2200);
          timers.push(
            window.setTimeout(() => {
              party = false;
              lookAt(700);
            }, 1100),
          );
          if (!reduce) burst(send);
        }, 180),
      );
    };
    engineRef.current = { celebrate: celebrateNow };

    // Delegated events survive mode changes (the password field only exists in
    // sign-in/sign-up modes, the form always does).
    on(document, 'focusin', (ev) => {
      const hit = kindOf(ev.target);
      if (!hit) return;
      idle = false;
      goal = at(hit.el, hit.kind);
      lookAt();
      if (hit.kind === 'pass') diveIntoPassword();
    });
    on(document, 'focusout', (ev) => {
      // Leaving the password retracts the dive and its inner light.
      if (kindOf(ev.target)?.kind !== 'pass') return;
      const pf = refs.passField.current;
      if (pf && dive === pf) {
        dive = null;
        pf.classList.remove('inside');
      }
    });
    on(document, 'click', (ev) => {
      const hit = kindOf(ev.target);
      if (!hit) return;
      idle = false;
      goal = at(hit.el, hit.kind);
      lookAt();
      // The eye toggles state in React; repaint once the class lands.
      if (hit.el === refs.eye.current) window.setTimeout(() => paintPassword(false), 60);
    });
    on(document, 'input', (ev) => {
      const hit = kindOf(ev.target);
      if (!hit) return;
      idle = false;
      if (hit.kind === 'email' && hit.el instanceof HTMLInputElement) {
        goal = caretGoal(hit.el, 'email');
        pulse();
      }
      if (hit.kind === 'pass' && hit.el instanceof HTMLInputElement) {
        paintPassword(true);
        diveIntoPassword();
        pulse();
      }
    });
    // Any submit send the firefly to the button; success celebration is separate.
    on(refs.form.current, 'submit', () => {
      idle = false;
      const send = refs.send.current;
      if (send) {
        goal = at(send, 'center');
        dive = send;
        lookAt();
      }
    });

    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      // Until someone uses the form, the firefly just drifts over it.
      if (idle) goal = idleGoal(now);
      const sr = stage.getBoundingClientRect();
      const srLeft = sr.left;
      const srTop = sr.top;
      const sw = sr.width || 1;
      const sh = sr.height || 1;
      const dt = 1 / 60;
      const box = dive?.getBoundingClientRect() ?? null;
      acc += Math.min(100, now - last);
      last = now;
      // 60 steps a second on any screen.
      for (; acc >= 1000 / 60; acc -= 1000 / 60) {
        // Critically damped spring: it arrives and stops. Zeta drops below 1
        // only in the victory constellation.
        const w = (2 * Math.PI) / RESP;
        const zeta = party ? BOUNCE : 1;
        vx += (w * w * (goal.x - x) - 2 * zeta * w * vx) * dt;
        vy += (w * w * (goal.y - y) - 2 * zeta * w * vy) * dt;
        x += vx * dt;
        y += vy * dt;
      }
      place(spark, x, y);
      const fast = Math.hypot(vx, vy) > TRAIL;
      if (fast && !reduce && ++step % 3 === 0) trail(x, y + 3);
      night.style.setProperty('--fx', `${x - srLeft}px`);
      night.style.setProperty('--fy', `${y - srTop}px`);
      const inside = !!box && x > box.left && x < box.right && y > box.top && y < box.bottom;
      spark.classList.toggle('inside', inside);
      const pf = refs.passField.current;
      if (dive === pf && pf && box) {
        pf.classList.toggle('inside', inside);
        if (inside) pf.style.setProperty('--gx', `${x - box.left}px`);
      }
      colonyStep(now, srLeft, srTop, sw, sh);
      wood(now, sw, sh);
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      owns.forEach((fn) => fn());
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(pulseT);
      transient.splice(0).forEach((n) => {
        if (n.isConnected) n.remove();
      });
      engineRef.current = null;
    };
  }, [refs]);

  // Victory moment on sign-in: light fills the button, the night lifts and the
  // colony holds a constellation over it.
  useEffect(() => {
    if (!celebrate || celebratedRef.current) return;
    celebratedRef.current = true;
    engineRef.current?.celebrate();
  }, [celebrate]);

  return (
    <>
      <div className="ff-air" ref={airRef} aria-hidden="true" />
      <div className="ff-colony" ref={colonyRef} aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="ff-night" ref={nightRef} aria-hidden="true" />
      <div className="ff-spark" ref={sparkRef} aria-hidden="true">
        <i className="glow" />
        <i className="wing l" />
        <i className="wing r" />
        <i className="head" />
        <i className="body" />
      </div>
    </>
  );
}
