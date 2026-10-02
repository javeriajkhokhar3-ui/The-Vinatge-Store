// Runs before first paint so the entrance animation never flashes unstyled content.
(function () {
  var d = document.documentElement;
  d.classList.add('js');
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) d.classList.add('motion');
})();
