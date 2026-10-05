import { mountSchedulingView } from './ui/schedulingView.js';
import { mountMemoryView } from './ui/memoryView.js';
import { mountFragmentationView } from './ui/fragmentationView.js';
import { $ } from './ui/dom.js';

const views = {
  scheduling: mountSchedulingView(),
  memory: mountMemoryView(),
  fragmentation: mountFragmentationView(),
};
const tabs = [...document.querySelectorAll('.tab[data-view]')];

function show(name) {
  if (!(name in views)) name = 'scheduling';
  for (const [id, view] of Object.entries(views)) {
    if (id !== name) view.pause(); // don't keep animating something nobody can see
    $(`#view-${id}`).hidden = id !== name;
  }
  for (const tab of tabs) {
    if (tab.dataset.view === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    history.replaceState(null, '', `#${tab.dataset.view}`);
    show(tab.dataset.view);
  });
}
addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1));
