let endAt = 0;

function format(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function tick() {
  const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  document.getElementById('time').textContent = format(left);
}

window.fixMyselfMini.onView((view) => {
  endAt = view.endAt;
  document.getElementById('label').textContent = view.label;
  document.getElementById('status').textContent = view.status;
  tick();
});

setInterval(tick, 1000);
tick();
