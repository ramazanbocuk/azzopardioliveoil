/** Shown in place of an admin page while the server prepares it. */
export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" className="px-6 py-10 font-sans text-stone-700 lg:px-10">
      Loading…
    </div>
  );
}
