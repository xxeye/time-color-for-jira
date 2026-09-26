// On GitHub Pages, point the repository links at this site's own repository.
(function () {
  const match = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!match) return;
  const first = location.pathname.split('/').filter(Boolean)[0];
  const repo = first && !first.endsWith('.html') ? first : match[1] + '.github.io';
  const base = 'https://github.com/' + match[1] + '/' + repo;
  document.querySelectorAll('[data-repo]').forEach(link => {
    link.href = base + link.dataset.repo;
    link.hidden = false;
  });
  document.querySelectorAll('[data-repo-hide]').forEach(el => { el.hidden = true; });
})();
