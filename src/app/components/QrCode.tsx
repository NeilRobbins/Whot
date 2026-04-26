import { useEffect, useState } from "react";
import QRCode from "qrcode";

type Props = {
  value: string;
  size?: number;
  ariaLabel?: string;
};

export function QrCode({ value, size = 220, ariaLabel }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: "#0b1220", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          background: "var(--bg-3)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--danger)",
          fontSize: 12,
          padding: 12,
          textAlign: "center",
        }}
      >
        QR error: {error}
      </div>
    );
  }
  if (!dataUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          background: "var(--bg-3)",
          borderRadius: 8,
        }}
      />
    );
  }
  return (
    <img
      src={dataUrl}
      alt={ariaLabel ?? "Invite QR code"}
      width={size}
      height={size}
      style={{ borderRadius: 8, display: "block", background: "white" }}
    />
  );
}
