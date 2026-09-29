/**
 * Who owns a keystroke.
 *
 * One question, asked in two places: a shortcut that belongs to the browser
 * while the browser is editing text must not be claimed by the app. It is
 * isolated here rather than inlined in the view that needs it so it can be
 * tested without mounting the whole app, and so the next shortcut that hits the
 * same wall has somewhere obvious to go.
 */

/**
 * True when the keystroke belongs to a field the BROWSER is editing.
 *
 * Ctrl+Z is the browser's undo, not ours, wherever there is a text buffer with
 * its own history. The markdown outline is a <textarea>, so the window handler
 * in TherapistView was calling preventDefault() and applying a TREE undo — and
 * the tree history has no entry for "typed this" or "deleted this", because
 * typing is recorded with reason 'typing' and deliberately never enters it. A
 * therapist who selected the whole buffer and deleted it had no way back, and
 * that is the worst possible outcome in the one editor where the whole session
 * can be retyped from memory in a second. It looked like Ctrl+Z was broken; it
 * was working perfectly, on the wrong history.
 *
 * <input> is deliberately NOT in this set. A row in the outline editor is an
 * input, and Ctrl+Z undoing the last structural edit there is the behaviour
 * that was asked for and is covered by tests. Quietly taking it away to fix a
 * different editor would trade a real feature for this bug — and an <input>
 * with no undo history of its own is not the field that lost the work.
 */
export function isBrowserUndoTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}
