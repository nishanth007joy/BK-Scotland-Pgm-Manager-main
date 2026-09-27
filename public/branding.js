(async () => {
  try {
    const response = await fetch('/api/current-event', { cache: 'no-store' });
    if (!response.ok) return;
    const { currentEventName } = await response.json();
    if (typeof currentEventName !== 'string' || !currentEventName.trim()) return;
    const title = currentEventName.trim();
    const brandedElements = new Set();
    document.querySelectorAll('title, h1, h2, h3, p').forEach(element => {
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && /Bible Kalothsavam - Scotland(?: \d{4})?/.test(node.textContent)) {
          node.textContent = node.textContent.replace(/Bible Kalothsavam - Scotland(?: \d{4})?/g, () => title);
          brandedElements.add(element);
        }
      }
    });
    document.querySelectorAll('h1').forEach(heading => {
      if (heading.closest('#accessDenied') || brandedElements.has(heading)
        || [...heading.parentElement.children].some(element => brandedElements.has(element))) return;
      const label = document.createElement('p');
      label.className = 'text-secondary mb-1';
      label.textContent = title;
      heading.insertAdjacentElement('afterend', label);
    });
  } catch {
    // Keep the existing HTML titles if the setting cannot be loaded.
  }
})();
