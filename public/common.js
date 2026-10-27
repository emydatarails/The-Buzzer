// Shared bits for the player and admin pages: backdrop, storage, toasts, sound.
const $ = id => document.getElementById(id);

const BAT = '<path d="M32 22c-3-8-9-12-16-10 2 3 2 6 0 8-5-2-11 0-16 6 6-1 10 1 13 5 3-1 6 0 8 3 3-7 8-9 11-9s8 2 11 9c2-3 5-4 8-3 3-4 7-6 13-5-5-6-11-8-16-6-2-2-2-5 0-8-7-2-13 2-16 10z"/>';
document.body.insertAdjacentHTML('afterbegin', `
<div class="backdrop" aria-hidden="true">
  <div class="moon"></div><div class="fog f1"></div><div class="fog f2"></div>
  <div class="embers">${[[6,0],[14,3,17],[23,7],[37,1,19],[48,9],[61,5,16],[72,11],[83,2,18],[91,8],[96,13,15]]
    .map(([l, d, s]) => `<i style="left:${l}%;animation-delay:${d}s${s ? `;animation-duration:${s}s` : ''}"></i>`).join('')}</div>
  <div class="bats">
    <svg viewBox="0 0 64 40" style="animation-duration:26s">${BAT}</svg>
    <svg viewBox="0 0 64 40" style="animation-duration:34s;animation-delay:-12s;width:48px;height:30px">${BAT}</svg>
    <svg viewBox="0 0 64 40" style="animation-name:bat2;animation-duration:30s;animation-delay:-5s">${BAT}</svg>
    <svg viewBox="0 0 64 40" style="animation-name:bat2;animation-duration:40s;animation-delay:-22s;width:40px;height:25px">${BAT}</svg>
  </div>
  <div class="vignette"></div>
</div>
<div id="flash" aria-hidden="true"></div>
<div class="toast" id="toast" role="status"></div>`);

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer;
function toast(msg, kind = '', ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast on ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

function flash(kind = '') {
  const f = $('flash');
  f.className = kind;
  void f.offsetWidth;
  f.className = `on ${kind}`;
}

// Splits "The Walking Debt 🧟" into { name: "The Walking Debt", emoji: "🧟" }.
function teamParts(n) {
  const m = String(n).match(/^(.*?)\s*(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)?$/u) || [];
  return { name: m[1] || n, emoji: m[2] || '🎃' };
}

/* ---------- sound (WebAudio, generated, same voice as the main game) ---------- */
let actx = null, master = null, muted = store.get('bz-muted', false);
function audio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(actx.destination);
    } catch {}
  }
  if (actx && actx.state === 'suspended') actx.resume();
}
function tone(f, d, type = 'sine', v = .18, delay = 0, slide) {
  if (!actx) return;
  const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(g).connect(master); o.start(t); o.stop(t + d + .05);
}
function noise(d, v = .2, delay = 0, cut = 800) {
  if (!actx) return;
  const t = actx.currentTime + delay, n = Math.ceil(actx.sampleRate * d), b = actx.createBuffer(1, n, actx.sampleRate), ch = b.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
  const s = actx.createBufferSource(); s.buffer = b;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut;
  const g = actx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + d + .02);
}
const SFX = {
  buzz() { tone(110, .35, 'sawtooth', .16); tone(116, .35, 'square', .06); noise(.12, .2, 0, 1800); },
  first() { [523, 659, 784, 1047].forEach((f, i) => { tone(f, .2, 'triangle', .15, i * .08); tone(f * 2, .14, 'sine', .03, i * .08); }); },
  late() { [330, 277, 220].forEach((f, i) => tone(f, .3, 'triangle', .12, i * .14)); },
  point() { [660, 990, 1320].forEach((f, i) => { tone(f, .14, 'triangle', .14, i * .09); tone(f * 2, .1, 'sine', .03, i * .09); }); },
  minus() { tone(440, .28, 'triangle', .12, 0, 200); },
  ding() { tone(988, .25, 'triangle', .16); tone(1318, .3, 'sine', .08, .08); noise(.05, .15, 0, 3000); },
};
function setupMute(btn) {
  const paint = () => {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.classList.toggle('off', muted);
    btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  };
  paint();
  btn.onclick = () => {
    muted = !muted;
    store.set('bz-muted', muted);
    audio();
    if (master) master.gain.value = muted ? 0 : 1;
    paint();
  };
}
