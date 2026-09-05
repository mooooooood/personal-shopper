// Navigation stays usable when WebGL or the optional 3D module is unavailable.
const stage = document.querySelector('[data-stage]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const tabs = [...document.querySelectorAll('[data-scene]')];
const labels = [
  ['TRAIN', '力量，从这里开始。', '健身器械 · 探索训练的更多可能'],
  ['EXPLORE', '下一次，去更远的水边。', '钓鱼装备 · 为每一次出发准备'],
  ['PLAY', '让你的声音，被听见。', '电吉他与乐器 · 找到自己的节奏']
];
let viewer;
let selected = 0;
function select(index) {
  selected = index;
  tabs.forEach((tab, i) => tab.setAttribute('aria-pressed', String(i === index)));
  stage.dataset.active = String(index);
  document.querySelector('[data-scene-word]').textContent = labels[index][0];
  document.querySelector('[data-scene-title]').textContent = labels[index][1];
  document.querySelector('[data-scene-caption]').textContent = labels[index][2];
  document.querySelector('[data-counter]').textContent = `0${index + 1} / 03`;
  viewer?.select(index);
}
tabs.forEach((tab, index) => tab.addEventListener('click', () => select(index)));
const toggle = document.querySelector('[data-motion]');
toggle.disabled = true;
const fallback = document.querySelector('[data-fallback]');
function unavailable() {
  stage.classList.remove('has-3d');
  toggle.disabled = true;
  document.querySelector('[data-stage-hint]').textContent = '探索三个装备世界';
  fallback.hidden = false;
}
if (stage) {
  import('./showroom.js').then(({ createShowroom }) => {
    viewer = createShowroom(stage, reducedMotion.matches, unavailable);
    viewer.select(selected);
    stage.classList.add('has-3d');
    fallback.hidden = true;
    toggle.disabled = false;
    const updateMotion = () => {
      toggle.textContent = viewer.isPlaying() ? '暂停旋转 Ⅱ' : '自动旋转 ↻';
      toggle.setAttribute('aria-pressed', String(viewer.isPlaying()));
    };
    updateMotion();
    toggle.addEventListener('click', () => { viewer.setPlaying(!viewer.isPlaying()); updateMotion(); });
    reducedMotion.addEventListener('change', e => { viewer.setPlaying(!e.matches); updateMotion(); });
    document.querySelector('[data-stage-hint]').textContent = '左右拖动旋转 · 方向键调整视角';
  }).catch(unavailable);
}
// Mouse-only card depth, with no listeners on touch or reduced-motion devices.
if (matchMedia('(hover: hover) and (pointer: fine)').matches && !reducedMotion.matches) {
  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('pointermove', e => {
      const box = card.getBoundingClientRect();
      card.style.transform = `perspective(900px) rotateX(${-(e.clientY - box.top - box.height / 2) / 65}deg) rotateY(${(e.clientX - box.left - box.width / 2) / 65}deg)`;
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  });
}
if ('IntersectionObserver' in window && !reducedMotion.matches) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('revealed'); observer.unobserve(entry.target); }
  }), { threshold: .08 });
  document.querySelectorAll('.section-heading, .about-inner, .contact, .product-card').forEach(el => {
    el.classList.add('reveal'); observer.observe(el);
  });
}
