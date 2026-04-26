import { useApp } from "../store";

export function ErrorBanner() {
  const errorBanner = useApp((s) => s.errorBanner);
  const setError = useApp((s) => s.setError);
  if (!errorBanner) return null;
  return (
    <div className="banner" role="alert" onClick={() => setError(undefined)}>
      {errorBanner}
    </div>
  );
}
