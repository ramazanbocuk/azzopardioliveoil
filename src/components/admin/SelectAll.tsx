"use client";

/** Header checkbox that ticks or clears every row checkbox with the given name inside the same form. */
export function SelectAll({ name, label }: { name: string; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-4 accent-olive-700"
      onChange={(event) => {
        const boxes = event.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`);
        boxes?.forEach((box) => (box.checked = event.currentTarget.checked));
      }}
    />
  );
}
