import { logoLockupSvg, logoMarkSvg } from '@shared/branding'

export function Logo({ height = 40 }: { height?: number }) {
  return <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: logoLockupSvg({ height }) }} />
}

export function LogoMark({ size = 40 }: { size?: number }) {
  return <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: logoMarkSvg(size) }} />
}

export function LogoPlate({ height = 34 }: { height?: number }) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 10,
        padding: '8px 12px',
        display: 'inline-flex'
      }}
    >
      <Logo height={height} />
    </div>
  )
}
