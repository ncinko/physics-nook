/**
 * Puts text on the clipboard, resolving to whether it got there.
 *
 * The async clipboard API is refused in some embeddings and permission
 * policies, fullscreen among them, so a hidden-textarea `execCommand` is tried
 * next. When both fail the caller should show the text for copying by hand
 * rather than leave a button that looked like it worked.
 *
 * Callers must build the text before any `await`, so the write still runs
 * inside the click's user activation.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea route.
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
};
