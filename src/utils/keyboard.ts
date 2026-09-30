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
 * Ctrl+Z is the browser's undo, not ours, wherever there is a text field with
 * its own history. The window handler in TherapistView was calling
 * preventDefault() and applying a TREE undo — and the tree history has no entry
 * for "typed this" or "deleted this", because typing is recorded with reason
 * 'typing' and deliberately never enters it. A therapist who selected the whole
 * markdown buffer and deleted it had no way back, and that is the worst
 * possible outcome in the one editor where the whole session can be retyped
 * from memory in a second. It looked like Ctrl+Z was broken; it was working
 * perfectly, on the wrong history.
 *
 * This used to stop at <textarea> and exclude <input>, because the row editor
 * was a list of text inputs whose undo was deliberately the tree's. That editor
 * is gone, and with it the only reason for the exception: every remaining input
 * in the app is a field in a dialog — a client's name, a map's title, a search
 * box — where undoing a mind map is never what was meant. One rule now, and it
 * is the rule that was always right.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return true;
  return el.isContentEditable === true;
}
