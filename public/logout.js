document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await fetch('/logout', { method: 'POST' });
      } finally {
        window.location.assign('/');
      }
    });
  });
});
