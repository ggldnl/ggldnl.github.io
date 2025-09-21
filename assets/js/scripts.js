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
  // Add a small delay to ensure all elements are fully rendered
  setTimeout(() => {
    const zoomableImages = document.querySelectorAll('.article-image');
    const overlay = document.getElementById('zoomOverlay');
    const zoomImage = document.getElementById('zoomImage');
    const closeBtn = document.getElementById('zoomClose');

    // Check if required elements exist before proceeding
    if (!overlay || !zoomImage || !closeBtn) {
      console.warn('Zoom overlay elements not found');
      return;
    }

    zoomableImages.forEach((img, index) => {
      img.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // console.log(`Image ${index + 1} clicked:`, this.src);
        
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

    // Close on overlay click (but not on image click)
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        closeZoom();
      }
    });

    // Close on close button click
    closeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      closeZoom();
    });

    // Close on escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && overlay.classList.contains('active')) {
        closeZoom();
      }
    });
  }, 200);
}

// Initialize when page loads - use multiple events for better compatibility
document.addEventListener('DOMContentLoaded', function() {
  document.body.classList.add('loaded');
  initImageZoom();
});

// Backup initialization in case DOMContentLoaded has already fired
if (document.readyState === 'loading') {
  // DOM is still loading
  document.addEventListener('DOMContentLoaded', initImageZoom);
} else {
  // DOM has already loaded
  initImageZoom();
}

// Additional fallback for window load event
window.addEventListener('load', function() {
  // Only initialize if not already done
  const overlay = document.getElementById('zoomOverlay');
  if (overlay && !overlay.hasAttribute('data-zoom-initialized')) {
    overlay.setAttribute('data-zoom-initialized', 'true');
    initImageZoom();
  }
});