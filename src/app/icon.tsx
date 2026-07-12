import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: '#ffffff' }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: '34px',
          height: '34px',
          overflow: 'hidden',
          border: '1.5px solid #333333',
          flexShrink: 0,
        }}>
          <div style={{
            flex: 1,
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#000000',
            fontSize: 8,
            fontWeight: 900,
            letterSpacing: '0.08em',
            lineHeight: 1,
            fontFamily: 'Arial, Helvetica, sans-serif',
          }}>
            KASA
          </div>
          <div style={{ height: 1.5, background: '#333333' }} />
          <div style={{
            flex: 1,
            background: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          fontSize: 8,
          fontWeight: 900,
          letterSpacing: '0.08em',
          lineHeight: 1,
          fontFamily: 'Arial, Helvetica, sans-serif',
          }}>
            KAI
          </div>
        </div>
      </div>
    ),
    size,
  );
}
