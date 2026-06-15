// ============================================
// GIRL THERAPY — Shared interactions
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Mobile nav toggle
  const toggle = document.querySelector('.nav__toggle');
  const mobileNav = document.querySelector('.nav__mobile');

  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const isOpen = mobileNav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close mobile nav on link click
    mobileNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Scroll reveal
  const revealEls = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && revealEls.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });

    revealEls.forEach((el) => observer.observe(el));

    // Safety net: reveal anything still hidden shortly after load
    // (covers edge cases where the observer doesn't fire, e.g. very
    // short pages, print views, or non-standard viewports)
    window.addEventListener('load', () => {
      setTimeout(() => {
        revealEls.forEach((el) => el.classList.add('is-visible'));
      }, 1200);
    });
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  // ============================================
  // Form submission → Google Sheet via Apps Script
  // ============================================
  // Deployed Apps Script web app (see scripts/apps-script-form-handler.gs).
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxKM0AsGSR7_06VDc8bgAv-JQHj12_Rnc4Il4eiU5VD6IBuyiuHukO1OznD3Q7106jZrQ/exec';

  // Forms can use either pattern:
  //  - data-placeholder-form + .form__status (older multi-section pages)
  //  - data-form-type + data-wl-form / data-wl-success / data-wl-error (coming-soon hero)
  document.querySelectorAll('[data-placeholder-form], #waitlist-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formType = form.dataset.formType || 'waitlist';
      const submitBtn = form.querySelector('button[type="submit"]');

      // Pattern A: status line
      const status = form.querySelector('.form__status');
      const successMessage = form.dataset.successMessage || "Thanks! We'll be in touch soon.";

      // Pattern B: success/error blocks + form-fields container
      const fieldsBlock = form.querySelector('[data-wl-form]');
      const successBlock = form.querySelector('[data-wl-success]');
      const errorBlock = form.querySelector('[data-wl-error]');

      const showSuccess = () => {
        if (status) {
          status.textContent = successMessage;
          status.classList.add('is-visible');
        }
        if (fieldsBlock) fieldsBlock.style.display = 'none';
        if (successBlock) successBlock.classList.add('is-visible');
        if (errorBlock) errorBlock.classList.remove('is-visible');
      };

      const showError = (message) => {
        if (status) {
          status.textContent = message || "Something went wrong — please try again or email us directly.";
          status.classList.add('is-visible');
        }
        if (errorBlock) {
          if (message) errorBlock.textContent = message;
          errorBlock.classList.add('is-visible');
        }
      };

      if (!FORM_ENDPOINT) {
        showSuccess();
        form.reset();
        return;
      }

      const payload = { formType };
      new FormData(form).forEach((value, key) => {
        payload[key] = value;
      });

      if (submitBtn) submitBtn.disabled = true;

      try {
        await fetch(FORM_ENDPOINT, {
          method: 'POST',
          mode: 'no-cors', // Apps Script web apps don't return CORS headers
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        });
        // With mode: 'no-cors' we can't read the response, so we
        // optimistically show success. Errors will still show in
        // the Apps Script execution log for debugging.
        showSuccess();
        form.reset();
      } catch (err) {
        showError();
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });
});
