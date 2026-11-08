(() => {
  const toc = document.querySelector(".docs-side details");
  const wide = window.matchMedia("(min-width: 901px)");
  const syncToc = () => {
    if (toc) toc.open = wide.matches;
  };
  wide.addEventListener("change", syncToc);
  syncToc();

  const links = new Map(
    [...document.querySelectorAll(".docs-side a[href^='#']")].map((a) => [a.getAttribute("href").slice(1), a])
  );
  const sections = [...document.querySelectorAll(".docs-main section[id]")];
  const setActive = (id) => links.forEach((a, key) => a.classList.toggle("active", key === id));

  let ticking = false;
  const spy = () => {
    ticking = false;
    let current = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= 120) current = s;
      else break;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = sections[sections.length - 1];
    if (current) setActive(current.id);
  };
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(spy);
    }
  }, { passive: true });
  spy();

  links.forEach((a) =>
    a.addEventListener("click", () => {
      if (!wide.matches && toc) toc.open = false;
    })
  );
})();
