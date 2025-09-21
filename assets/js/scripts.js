// Staggered animation logic
document.addEventListener("DOMContentLoaded", () => {
  const elements = document.querySelectorAll("body *");
  
  elements.forEach((el, index) => {
    el.style.transitionDelay = `${index * 0.01}s`; // staggered effect
  });

  // Trigger animation
  document.body.classList.add("loaded");
});

// Copy button on the code block
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("pre code").forEach((codeBlock) => {
        const button = document.createElement("button");
        button.className = "copy-btn";
        button.textContent = "📋"; // emoji

        const pre = codeBlock.parentNode;
        pre.style.position = "relative"; // ensure button positions correctly
        pre.appendChild(button);

        button.addEventListener("click", () => {
            navigator.clipboard.writeText(codeBlock.innerText).then(() => {
                button.textContent = "✅"; // show checkmark
                setTimeout(() => button.textContent = "📋", 2000); // revert back
            });
        });
    });
});

// Image zoom functionality
function initImageZoom() {
  const zoomableImages = document.querySelectorAll('.article-image');
  const overlay = document.getElementById('zoomOverlay');
  const zoomImage = document.getElementById('zoomImage');
  const closeBtn = document.getElementById('zoomClose');

  zoomableImages.forEach(img => {
    img.addEventListener('click', function() {
      zoomImage.src = this.src;
      zoomImage.alt = this.alt;
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });

  function closeZoom() {
    overlay.classList.remove('active');
    document.body.style.overflow = 'auto';
  }

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeZoom();
  });

  closeBtn.addEventListener('click', closeZoom);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('active')) {
      closeZoom();
    }
  });
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
  document.body.classList.add('loaded');
  initImageZoom();
});