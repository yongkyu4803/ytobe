export default function GqaiIcon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} className="gqai-icon" focusable="false" viewBox={name.startsWith('content-') ? '0 0 32 32' : name.startsWith('reaction-') ? '0 0 48 48' : '0 0 24 24'}><use href={`/gqai/icons.svg#${name}`} /></svg>;
}
