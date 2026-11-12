import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function QrCode({ value, size = 240 }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(''));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return src ? (
    <img className="qr" src={src} width={size} height={size} alt={`QR code for ${value}`} />
  ) : (
    <div className="qr" style={{ width: size, height: size }} />
  );
}
