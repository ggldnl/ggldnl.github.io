
// ToC Highlight logic 
document.addEventListener("DOMContentLoaded", function () {
    const sections = document.querySelectorAll("article h2[id]");
    const tocLinks = document.querySelectorAll(".toc-link");

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // remove active class from all links
                    tocLinks.forEach(link => link.classList.remove("active"));
                    // find the link that matches the visible section
                    const activeLink = document.querySelector(
                        `.toc a[href="#${entry.target.id}"]`
                    );
                    if (activeLink) activeLink.classList.add("active");
                }
            });
        },
        { threshold: 0.5 } // section must be at least 50% visible
    );

    sections.forEach(section => observer.observe(section));
});

// Staggered animation logic
document.addEventListener("DOMContentLoaded", () => {
  const elements = document.querySelectorAll("body *");
  
  elements.forEach((el, index) => {
    el.style.transitionDelay = `${index * 0.01}s`; // staggered effect
  });

  // Trigger animation
  document.body.classList.add("loaded");
});
