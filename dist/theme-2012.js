// Twenty Twelve's mobile-menu behavior, with button semantics and aria state.
const navigation = document.querySelector('#site-navigation');
const toggle = navigation.querySelector('.menu-toggle');
const menu = navigation.querySelector('.nav-menu');
toggle.addEventListener('click', () => {
  const open = menu.classList.toggle('toggled-on');
  toggle.classList.toggle('toggled-on', open);
  toggle.setAttribute('aria-expanded', String(open));
});
for (const link of menu.querySelectorAll('a')) link.addEventListener('click', () => {
  menu.classList.remove('toggled-on');
  toggle.classList.remove('toggled-on');
  toggle.setAttribute('aria-expanded', 'false');
});
