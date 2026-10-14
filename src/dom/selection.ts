// Selection capture for the overlay bubble ("ask about this").
// Takes the window explicitly so it is testable without globals.

export function readSelection(win: Pick<Window, "getSelection">): string {
  try {
    return win.getSelection()?.toString() ?? "";
  } catch {
    return "";
  }
}
